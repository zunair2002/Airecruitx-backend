import mongoose from "mongoose";
import { getEnv } from "./env";
import { logger } from "./logger";

export const connectDB = async (): Promise<void> => {
  const { mongoUri } = getEnv();

  try {
    await mongoose.connect(mongoUri);
    logger.info("MongoDB connected");
  } catch (error) {
    logger.error({ err: error }, "MongoDB connection failed");
    process.exit(1);
  }
};
