import axios from "axios";
import { OLLAMA_BASE_URL, OLLAMA_MODEL } from "../config/ollama";
import { AppError } from "../utils/AppError";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Talks to the locally running Ollama server hosting the fine-tuned interviewer
// model (see OllamaLLM/Modelfile for its interview behavior/system prompt).
export const chat = async (messages: ChatMessage[]): Promise<string> => {
  try {
    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/chat`,
      { model: OLLAMA_MODEL, messages, stream: false },
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
  }
};
