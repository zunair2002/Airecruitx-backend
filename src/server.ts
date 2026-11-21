import dotenv from "dotenv";
dotenv.config();

import http from "http";
import app from "./app";
import { connectDB } from "./config/db";
import { initSocket } from "./config/socket";
import { startOrgInterviewExpiryScheduler } from "./config/orgInterviewExpiryScheduler";
import { startInterviewTimerScheduler } from "./config/interviewTimerScheduler";
import { startPlanExpiryScheduler } from "./config/planExpiryScheduler";
import "./config/firebase";
import { validatePracticeBank } from "./ai/practiceBank";
import dns from "dns";

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const PORT = process.env.PORT || 5000;

const start = async () => {
  // Practice questions (src/ai/practice_questions.json): loaded + validated once; problems are logged
  validatePracticeBank();
  await connectDB();

  const httpServer = http.createServer(app);
  initSocket(httpServer);
  startOrgInterviewExpiryScheduler();
  startInterviewTimerScheduler();
  startPlanExpiryScheduler();

  httpServer.listen(PORT, () => {
    console.log(`Airecruitx backend running on port ${PORT}`);
  });

  const shutdown = async () => {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve());
    });
    process.exit(0);
  };
  process.once("SIGTERM", () => {
    void shutdown().catch((error) => {
      console.error("[server] Graceful shutdown failed:", error);
      process.exit(1);
    });
  });
  process.once("SIGINT", () => {
    void shutdown().catch((error) => {
      console.error("[server] Graceful shutdown failed:", error);
      process.exit(1);
    });
  });
};

start();
