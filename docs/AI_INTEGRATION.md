# AI integration: fine-tuned Phi-4-mini

The interview module now uses the fine-tuned AIRecruitX model, served by vLLM with an OpenAI-compatible API, in place of the old Ollama chat loop.

## How an interview runs

1. **Start** (`POST /api/.../interview/start`, the application flows and HR scheduling).
   - The backend generates **5 basic and 8 technical questions** up front. Each question is stored with its `keyPoints`, which describe what a good answer contains.
   - Technical topics come from the job title and `requiredSkills`. Practice interviews use a CS-core mix.
   - The model gets 30 s to generate questions. If it is slow (cold GPU) or down, questions come from `src/ai/question_bank.json`, which holds 1,589 questions, so an interview can always start.
   - The GPU server is woken in the background as soon as the interview starts.
2. **Answer.** The answer is saved, the next question is returned immediately, and the answer is evaluated in the background.
   - The evaluation returns a verdict, four criterion scores (0–10), feedback, an improvement tip and weak topics.
3. **Last answer.** The request waits for any outstanding evaluations (up to `AI_FINAL_WAIT_MS`). The backend then computes the scores, and the model writes the report.

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
- **Background evaluations** run in memory. If the server restarts mid-interview, pending evaluations are re-run when the last answer is submitted.
