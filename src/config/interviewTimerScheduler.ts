import cron from "node-cron";
import {
  finalizeExpiredSessions,
  recoverPendingInterviewJobs,
} from "../candidate/interview/service/interview.service";

// Every 30 seconds, finishes expired interviews and recovers pending queue work. BullMQ job IDs
// deduplicate finalization across instances.
export const startInterviewTimerScheduler = (): void => {
  let running = false;
  cron.schedule("*/30 * * * * *", async () => {
    if (running) return;
    running = true;
    try {
      const n = await finalizeExpiredSessions();
      if (n > 0) console.log(`[interviewTimerScheduler] Finishing ${n} timed-out interview(s).`);
      const recovered = await recoverPendingInterviewJobs();
      if (recovered > 0) {
        console.log(`[interviewTimerScheduler] Re-enqueued ${recovered} pending interview job(s).`);
      }
    } catch (error) {
      console.error("[interviewTimerScheduler] Failed to recover interview jobs:", error);
    } finally {
      running = false;
    }
  });
};
