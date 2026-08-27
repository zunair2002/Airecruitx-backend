import cron from "node-cron";
import { Application } from "../shared/application/model/application.model";

// Runs every 15 minutes and flips any org-interview invite whose validity window has
// passed — without the candidate finishing it — from "invited" to "expired". This is
// a backstop: the same expiry is also checked live (against expiresAt directly) the
// moment a candidate opens their link, so an invite is never usable past its window
// even in the gap before this sweep next runs; this just keeps HR's view accurate
// for invites nobody ever opens again.
export const startOrgInterviewExpiryScheduler = (): void => {
  cron.schedule("*/15 * * * *", async () => {
    try {
      const result = await Application.updateMany(
        {
          "orgInterview.status": "invited",
          "orgInterview.expiresAt": { $lt: new Date() },
        },
        { $set: { "orgInterview.status": "expired" } }
      );
      if (result.modifiedCount > 0) {
        console.log(`[orgInterviewExpiryScheduler] Expired ${result.modifiedCount} org-interview invite(s).`);
      }
    } catch (error) {
      console.error("[orgInterviewExpiryScheduler] Failed to sweep expired invites:", error);
    }
  });
};
