import { getEnv } from "./env";

export const OLLAMA_BASE_URL = getEnv().ollamaBaseUrl;
export const OLLAMA_MODEL = getEnv().ollamaModel;
