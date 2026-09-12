// Single source of truth for environment configuration. Validated once at boot
// (see assertEnv() call in server.ts) so misconfiguration fails immediately on
// startup instead of on the first request that happens to touch that variable.

interface EnvConfig {
  nodeEnv: string;
  port: number;
  mongoUri: string;
  jwtSecret: string;
  appBaseUrl: string;

  stripeSecretKey: string;
  certificatePassScore: number;
  certificatePriceCents: number;
  certificateCurrency: string;

  cloudinaryCloudName: string;
  cloudinaryApiKey: string;
  cloudinaryApiSecret: string;

  firebaseProjectId: string;
  firebaseClientEmail: string;
  firebasePrivateKey: string;

  ollamaBaseUrl: string;
  ollamaModel: string;
}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const optionalNumber = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name} must be a number, got: ${raw}`);
  }
  return value;
};

let cached: EnvConfig | undefined;

// Reads and validates all required environment variables. Throws with a clear
// message naming the missing variable if anything required is absent.
export const loadEnv = (): EnvConfig => {
  if (cached) return cached;

  cached = {
    nodeEnv: process.env.NODE_ENV || "development",
    port: optionalNumber("PORT", 5000),
    mongoUri: required("MONGO_URI"),
    jwtSecret: required("JWT_SECRET"),
    appBaseUrl: process.env.APP_BASE_URL || "http://localhost:5000",

    stripeSecretKey: required("STRIPE_SECRET_KEY"),
    certificatePassScore: (() => {
      const raw = process.env.CERTIFICATE_PASS_SCORE;
      const value = Number(raw);
      if (!raw || Number.isNaN(value)) {
        throw new Error("Missing required environment variable: CERTIFICATE_PASS_SCORE");
      }
      return value;
    })(),
    certificatePriceCents: optionalNumber("CERTIFICATE_PRICE_CENTS", 500),
    certificateCurrency: process.env.CERTIFICATE_CURRENCY || "usd",

    cloudinaryCloudName: required("CLOUDINARY_CLOUD_NAME"),
    cloudinaryApiKey: required("CLOUDINARY_API_KEY"),
    cloudinaryApiSecret: required("CLOUDINARY_API_SECRET"),

    firebaseProjectId: required("FIREBASE_PROJECT_ID"),
    firebaseClientEmail: required("FIREBASE_CLIENT_EMAIL"),
    firebasePrivateKey: required("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),

    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    ollamaModel: process.env.OLLAMA_MODEL || "qwen-local",
  };

  return cached;
};

// Validates every required environment variable and throws immediately if any
// are missing or malformed. Call this once, first, in server.ts before anything
// else boots — a config error should stop the process before it starts listening.
export const assertEnv = (): EnvConfig => loadEnv();

export const getEnv = (): EnvConfig => {
  if (!cached) {
    throw new Error("Environment has not been loaded yet — call assertEnv() at startup first");
  }
  return cached;
};
