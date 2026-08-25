import cron from "node-cron";
import { Application } from "../shared/application/model/application.model";
import { Job } from "../shared/job/model/job.model";
import { User } from "../shared/user/model/user.model";
import { sendOrgInterviewReminder } from "../shared/email/email.service";

const REMINDER_WINDOW_MINUTES = 10;

// Runs every minute and emails a "starting soon" reminder (with the join link) for
// any organizational interview whose scheduled time falls within the next
// REMINDER_WINDOW_MINUTES — reminderSent guards against sending it more than once.
export const startReminderScheduler = (): void => {
  cron.schedule("* * * * *", async () => {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60_000);

    let dueApplications;
    try {
      dueApplications = await Application.find({
        "orgInterview.scheduled": true,
        "orgInterview.reminderSent": { $ne: true },
        "orgInterview.dateTime": { $gte: now, $lte: windowEnd },
      });
    } catch (error) {
      console.error("[reminderScheduler] Failed to query due interviews:", error);
      return;
    }

    for (const application of dueApplications) {
      try {
        const dateTime = application.orgInterview.dateTime;
        if (!dateTime) continue;

        const [candidate, job] = await Promise.all([
          User.findById(application.candidateId),
          Job.findById(application.jobId),
        ]);
        if (!candidate || !job) continue;

        const appBaseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
        const joinLink = `${appBaseUrl}/candidate/interview/org?applicationId=${application._id}`;

        await sendOrgInterviewReminder(candidate.email, candidate.name, job.title, dateTime, joinLink);

        application.orgInterview.reminderSent = true;
        await application.save();
      } catch (error) {
        console.error(`[reminderScheduler] Failed to send reminder for application ${application._id}:`, error);
      }
    }
  });
};
