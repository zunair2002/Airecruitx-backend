# AI integration: fine-tuned Phi-4-mini

The interview module now uses the fine-tuned AIRecruitX model, served by vLLM with an OpenAI-compatible API, in place of the old Ollama chat loop.

## Interview modes

| Mode | Structure |
|---|---|
| **Practice** (candidate) | Two separate sessions. **Round 1: Basic** (5 questions). **Round 2: Technical** (8 questions on the chosen **track**), which unlocks only if Round 1 scores ≥ `ROUND2_UNLOCK_SCORE` (default **50**). The final report and the certificate come from Round 2 and combine both rounds. |
| **Job AI interview / HR interview** | A single combined interview (5 basic + 8 technical). Technical topics come from the job's required skills. |
| **HR question set** | HR's own questions, graded against the reference answers. |

- **Tracks** replace the old easy/medium/hard levels: `frontend`, `backend`, `fullstack`, `data_ai`, `software_engineer`. `GET /api/interview/tracks` lists them.
- **Start a round:** `POST /api/interview/start` with body `{ "stage": "basic" | "technical", "track": "fullstack" }`.
  - Round 2 reuses the Round 1 track if none is given.
  - It returns 400 if Round 1 is missing and 403 if Round 1 is below the unlock score.
- **Session views** now include `stage`, `track` and `round`. A completed Round 1 includes `round2Unlocked`; a completed Round 2 includes `certificateEligible`.
- **Certificates** are refused for Round 1 sessions.
- **E-learning:** candidates can browse all active courses in the candidate dashboard at any time and are taken to that section after failing either practice round; course selection is not filtered by weak topics. Candidates fetch active courses with `GET /api/learning/courses`. HR manages the catalog through `POST /api/learning/courses`, `GET /api/learning/courses/hr`, and `PUT`/`DELETE` `/api/learning/courses/:courseId`. Only HR accounts can manage courses. Each course has a title, description, HTTPS video URL, and one or more supported interview topic IDs. YouTube videos play inline; other providers open their course page in a new tab.

## How an interview runs

1. **Start** (`POST /api/.../interview/start`, the application flows and HR scheduling).
   - The backend generates **5 basic and 8 technical questions** up front. Each question is stored with its `keyPoints`, which describe what a good answer contains.
   - Technical topics come from the job title and `requiredSkills`. Practice interviews use a CS-core mix.
   - The model gets 30 s to generate questions. If it is slow (cold GPU) or down, questions come from `src/ai/question_bank.json`, which holds 1,589 questions, so an interview can always start.
   - The GPU server is woken in the background as soon as the interview starts.
2. **Answer.** The answer is saved, the next question is returned immediately, and the answer is evaluated in the background.
   - The evaluation returns a verdict, four criterion scores (0–10), feedback, an improvement tip and weak topics.
3. **Last answer.** The request waits for outstanding evaluations (up to `AI_FINAL_WAIT_MS`). The backend then computes the scores, and the model writes the report. The response shape is unchanged.

## Scoring (deterministic, in `src/ai/scoring.ts`)

| Item | Formula |
|---|---|
| Technical question | 0.40 × accuracy + 0.25 × completeness + 0.20 × problem solving + 0.15 × communication |
| Basic question | 0.30 × relevance + 0.25 × structure + 0.25 × communication + 0.20 × professionalism |
| Stage score | Average of that stage's question scores |
| Overall (0–10) | 0.4 × basic + 0.6 × technical. If one stage has no questions, the other stage counts fully. |
| `session.score` (0–100) | overall × 10, rounded |
| Practice result | `pass` if score ≥ `CERTIFICATE_PASS_SCORE` (default **70**). The certificate check now also uses ≥. |
| HR decision | overall ≥ 7 → shortlist, 5–7 → hold, below 5 → reject |

- **HR question sets** are graded with HR's reference answer as the key points. `marksEarned` = question score / 10 × marks, and `session.score` = marks percentage.
- **Failed evaluations** (model unreachable) are excluded from the averages and are not counted as zero.

## Report (`session.report`)

| Field | Content |
|---|---|
| `overallScore`, `basicScore`, `technicalScore` | The computed scores |
| `decision` | The pass/fail or HR decision |
| `summary` | Copied into `session.feedback` |
| `strengths` | List |
| `areasToImprove`, `learningPlan` | Candidate report only |
| `concerns`, `recommendation` | HR report only |
| `weakTopics` | Topics where the candidate was weak |
| `generatedBy` | `model` or `fallback` |

- **Who gets which report:** sessions visible to the candidate get a candidate report; hidden (organizational) sessions get an HR report.
- **When the fallback is used:** HR question sets and model failures get a deterministic report from `src/ai/report.ts`.
- **What the API returns:** `buildSessionView` now also returns `report`, plus `verdict`, `criteria` and `improvementTip` per turn, and `totalQuestions`. The existing fields are unchanged.

## Background work (in-process)

The backend runs as a single instance and keeps no external queue. MongoDB is the source of truth.

- **Answer evaluation** runs as an in-process background task through the AI queue (at most `AI_CONCURRENCY` model requests at once). A failed evaluation marks the turn `pending_eval`; it is retried once more before the report, and if it still fails the score is estimated and flagged.
- **Finalization and report generation** run in the request that submits the last answer (or in the timer sweep). Concurrent attempts for the same session share one run, and the final write is an atomic `in_progress` -> `completed`/`expired` update, so a session is never finalized twice.
- **Interview timer:** `expiresAt` in MongoDB is enforced on every answer, and a sweep every 30 seconds (`src/config/interviewTimerScheduler.ts`) finishes timed-out sessions and restarts pending evaluations (for example after a restart).
- **Emails** (OTP, organizational-interview invites) are sent in the background without blocking the request. They are retried twice (after 1 s and 5 s); a final failure is logged with recipient and kind only.
- **Auth rate limits** are in-memory fixed-window counters per IP and per email, returning HTTP 429 with `Retry-After`.

Because this state is in process memory, rate limits and in-flight tasks are per instance. Running several instances would need a shared store.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `AI_BASE_URL` | `http://localhost:8001` | Modal URL in production. The mock server runs on 8001. |
| `AI_API_KEY` | (empty) | Same value as `AIRECRUITX_API_KEY` in the Modal secret |
| `AI_MODEL` | `airecruitx` | Served model name |
| `AI_TIMEOUT_MS` | `180000` | Per request; covers a cold start |
| `AI_QGEN_TIMEOUT_MS` | `30000` | Question generation; after this the bank is used |
| `AI_FINAL_WAIT_MS` | `240000` | How long the last answer waits for evaluations |
| `AI_CONCURRENCY` | `8` | Model requests in flight at once |
| `AI_JSON_SCHEMA` | `true` | Schema-constrained JSON from vLLM |
| `INTERVIEW_BASIC_QUESTIONS` / `INTERVIEW_TECHNICAL_QUESTIONS` | `5` / `8` | |
| `ROUND2_UNLOCK_SCORE` | `50` | Practice Round 1 score (0–100) needed for Round 2 |
| `CERTIFICATE_PASS_SCORE` | `70` | 0–100 |

`OLLAMA_*` variables are no longer used.

## Local development without a GPU

```bash
npm run mock-ai     # terminal 1: mock model on http://localhost:8001
npm run dev         # terminal 2: backend (AI_BASE_URL=http://localhost:8001)
```

The mock server uses the same API as the real deployment. Its scores are heuristic (key-point overlap and answer length), not the real model's. Useful options:
- `MOCK_FAIL_RATE=0.3` tests failures and retries.
- `MOCK_DELAY_MS=3000` simulates a slow model.

## Notes

- **Prompts.** `src/ai/prompts.ts` and the user-message layouts in `src/ai/ai.service.ts` must match the training data exactly. Do not reword them.
- **Old in-progress sessions.** In-progress sessions from the old chat flow have no `selectedQuestions`. Starting again replaces them, and answering one returns 409 with a message to start a new interview.
- **Background evaluations** run in memory. If the server restarts mid-interview, pending evaluations are restarted by the 30-second sweep (and at startup), or when the last answer is submitted.
