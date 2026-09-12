import axios from "axios";
import { OLLAMA_BASE_URL, OLLAMA_MODEL } from "../../../config/ollama";
import { AppError } from "../../../utils/AppError";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatOptions {
  // Structured evaluator replies are short ("Score: X/Y\nFeedback: ...") — capping
  // generation length there cuts real wall-clock time on a local model, since it
  // stops generating once it hits the cap instead of free-running until it decides
  // to stop on its own. The free-form flow (a full question + feedback) needs more
  // room and is left uncapped by default.
  maxTokens?: number;
}

// Ollama unloads an idle model from memory after a few minutes by default, so the
// *next* call after any gap pays a full reload — often several seconds to tens of
// seconds on a local machine. keep_alive holds it resident for the duration of a
// typical interview so only the very first call in a while pays that cost.
const MODEL_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "30m";

// A local Ollama server serializes (or, at best, only lightly parallelizes) chat
// requests against one model — it does not scale to many simultaneous candidates on
// its own. Rather than let every concurrent call queue up invisibly inside axios
// until the 120s timeout fires as a generic-looking failure, this caps how many
// requests are actually in flight to Ollama at once and makes the rest wait *in
// order* for a free slot, failing fast with a clear "busy" message instead of a
// mysterious timeout if a slot never opens up. Tune OLLAMA_MAX_CONCURRENT to match
// what the machine running Ollama can actually sustain.
const MAX_CONCURRENT_REQUESTS = Number(process.env.OLLAMA_MAX_CONCURRENT ?? 2);
const QUEUE_WAIT_TIMEOUT_MS = 90_000;

let activeRequests = 0;
const waitQueue: Array<() => void> = [];

const acquireSlot = (): Promise<void> => {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests++;
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onTurn = () => {
      clearTimeout(timer);
      activeRequests++;
      resolve();
    };
    const timer = setTimeout(() => {
      const idx = waitQueue.indexOf(onTurn);
      if (idx !== -1) waitQueue.splice(idx, 1);
      reject(
        new AppError(
          "The interview model is busy with other candidates right now — please try again in a moment.",
          503
        )
      );
    }, QUEUE_WAIT_TIMEOUT_MS);
    waitQueue.push(onTurn);
  });
};

const releaseSlot = (): void => {
  activeRequests--;
  const next = waitQueue.shift();
  if (next) next();
};

// Talks to the locally running Ollama server hosting the fine-tuned interviewer
// model (see OllamaLLM/Modelfile for its interview behavior/system prompt).
export const chat = async (messages: ChatMessage[], chatOptions: ChatOptions = {}): Promise<string> => {
  await acquireSlot();
  try {
    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/chat`,
      {
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        keep_alive: MODEL_KEEP_ALIVE,
        ...(chatOptions.maxTokens ? { options: { num_predict: chatOptions.maxTokens } } : {}),
      },
      { timeout: 120_000 }
    );

    const content = response.data?.message?.content;
    if (!content || typeof content !== "string") {
      throw new AppError("The interview model returned an empty response", 502);
    }
    return content.trim();
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    console.error("[OllamaService] Failed to reach the interview model:", error?.message ?? error);
    throw new AppError("Could not reach the interview model. Is Ollama running?", 502);
  } finally {
    releaseSlot();
  }
};
