import cron from "node-cron";
import { finalizeExpiredSessions } from "../candidate/interview/service/interview.service";

// Every 30 seconds, finishes interviews whose time limit ran out while nobody was sending
// answers (tab closed, connection lost). Runs on every instance; the per-session Redis lock in
// interview.service.ts makes sure each session is finished only once.
export const startInterviewTimerScheduler = (): void => {
  cron.schedule("*/30 * * * * *", async () => {
    try {
      const n = await finalizeExpiredSessions();
      if (n > 0) console.log(`[interviewTimerScheduler] Finishing ${n} timed-out interview(s).`);
    } catch (error) {
      console.error("[interviewTimerScheduler] Failed to sweep timed-out interviews:", error);
    }
  });
};
