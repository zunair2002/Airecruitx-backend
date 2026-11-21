import cron from "node-cron";
import {
  finalizeExpiredSessions,
  recoverPendingInterviewJobs,
} from "../candidate/interview/service/interview.service";

// Finishes interviews whose time limit (MongoDB expiresAt) ran out and restarts pending
// background work (e.g. after a restart). Runs once at startup, then every 30 seconds.
// Double finalization is prevented by the in-process dedup map and the atomic
// "in_progress" -> "completed"/"expired" update in interview.service.ts.
export const startInterviewTimerScheduler = (): void => {
  let running = false;
  const sweep = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const n = await finalizeExpiredSessions();
      if (n > 0) console.log(`[interviewTimerScheduler] Finishing ${n} timed-out interview(s).`);
      const recovered = await recoverPendingInterviewJobs();
      if (recovered > 0) {
        console.log(`[interviewTimerScheduler] Restarted ${recovered} pending interview task(s).`);
      }
    } catch (error) {
      console.error("[interviewTimerScheduler] Failed to recover interview tasks:", error);
    } finally {
      running = false;
    }
  };
  void sweep();
  cron.schedule("*/30 * * * * *", sweep);
};
