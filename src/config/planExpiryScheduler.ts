import cron from "node-cron";
import { expireLapsedPlans } from "../shared/billing/service/billing.service";

// Hourly: premium plans whose end date has passed (a cancelled or unpaid subscription,
// or an admin grant that ran out) go back to free. Plan checks already treat a past
// planExpiresAt as free, so this only keeps the stored plan and notifications accurate.
export const startPlanExpiryScheduler = (): void => {
  let running = false;
  cron.schedule("7 * * * *", async () => {
    if (running) return;
    running = true;
    try {
      const n = await expireLapsedPlans();
      if (n > 0) console.log(`[planExpiryScheduler] Moved ${n} lapsed Premium plan(s) to Free.`);
    } catch (error) {
      console.error("[planExpiryScheduler] Failed to sweep lapsed plans:", error);
    } finally {
      running = false;
    }
  });
};
