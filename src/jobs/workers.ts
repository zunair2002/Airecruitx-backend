import { Job, Worker } from "bullmq";
import Redis from "ioredis";
import { AI_CONCURRENCY } from "../config/ai";
import {
  AnswerEvaluationJob,
  EmailDeliveryJob,
  InterviewFinalizationJob,
  ReportGenerationJob,
  StandaloneAnswerEvaluationJob,
  jobQueueNames,
} from "./queues";
import {
  markAnswerEvaluationFailed,
  processAnswerEvaluation,
  processInterviewFinalization,
  recoverPendingInterviewJobs,
} from "../candidate/interview/service/interview.service";
import {
  deliverOrgInterviewInvite,
  deliverOtpEmail,
} from "../shared/email/email.service";
import { evaluateAnswer, writeReportText } from "../ai/ai.service";
import { User } from "../shared/user/model/user.model";
import { Application } from "../shared/application/model/application.model";

const workerConnection = (): Redis => {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required to start background job workers");
  const connection = new Redis(url, {
    maxRetriesPerRequest: null,
    connectTimeout: 5000,
    retryStrategy: (times) => Math.min(times * 1000, 10_000),
  });
  connection.on("error", (error) => {
    console.error("[jobs] Worker Redis connection error:", error.message);
  });
  return connection;
};

let workers: Worker[] = [];

export const startBackgroundWorkers = (): void => {
  if (workers.length) return;
  if (!process.env.REDIS_URL) {
    console.warn("[jobs] Background jobs are disabled because REDIS_URL is not configured");
    return;
  }

  const evaluationWorker = new Worker<AnswerEvaluationJob>(
    jobQueueNames.evaluations,
    (job) => processAnswerEvaluation(job.data),
    { connection: workerConnection(), concurrency: AI_CONCURRENCY },
  );
  evaluationWorker.on("failed", (job, error) => {
    if (!job) return;
    console.error(`[jobs] Answer evaluation ${job.id} failed:`, error.message);
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void markAnswerEvaluationFailed(job.data).catch((updateError) => {
        console.error("[jobs] Could not record failed answer evaluation:", updateError);
      });
    }
  });

  const finalizationWorker = new Worker<InterviewFinalizationJob>(
    jobQueueNames.finalizations,
    (job) => processInterviewFinalization(job.data),
    { connection: workerConnection(), concurrency: 2 },
  );
  finalizationWorker.on("failed", (job, error) => {
    console.error(`[jobs] Interview finalization ${job?.id ?? "unknown"} failed:`, error.message);
  });

  const standaloneEvaluationWorker = new Worker<StandaloneAnswerEvaluationJob>(
    jobQueueNames.standaloneEvaluations,
    (job) => evaluateAnswer(job.data),
    { connection: workerConnection(), concurrency: AI_CONCURRENCY },
  );
  standaloneEvaluationWorker.on("failed", (job, error) => {
    console.error(`[jobs] Standalone answer evaluation ${job?.id ?? "unknown"} failed:`, error.message);
  });

  const reportWorker = new Worker<ReportGenerationJob>(
    jobQueueNames.reports,
    (job) => writeReportText(job.data.report),
    { connection: workerConnection(), concurrency: 2 },
  );
  reportWorker.on("failed", (job, error) => {
    console.error(`[jobs] Report generation ${job?.id ?? "unknown"} failed:`, error.message);
  });

  const emailWorker = new Worker<EmailDeliveryJob>(
    jobQueueNames.emails,
    async (job: Job<EmailDeliveryJob>) => {
      if (job.data.kind === "otp") {
        const valid = await User.exists({
          email: job.data.to.toLowerCase(),
          emailOtp: job.data.otp,
          emailOtpExpiresAt: { $gt: new Date() },
          emailVerified: false,
        });
        if (!valid) return;
        await deliverOtpEmail(job.data.to, job.data.name, job.data.otp);
        return;
      }
      const inviteIsCurrent = await Application.exists({
        _id: job.data.applicationId,
        "orgInterview.token": job.data.inviteToken,
        "orgInterview.status": "invited",
        "orgInterview.expiresAt": { $gt: new Date() },
      });
      if (!inviteIsCurrent) return;
      await deliverOrgInterviewInvite(
        job.data.to,
        job.data.candidateName,
        job.data.jobTitle,
        job.data.joinLink,
        new Date(job.data.expiresAt),
        job.data.calendarLink,
      );
    },
    { connection: workerConnection(), concurrency: 5 },
  );
  emailWorker.on("failed", (job, error) => {
    console.error(`[jobs] Email delivery ${job?.id ?? "unknown"} failed:`, error.message);
  });

  workers = [
    evaluationWorker,
    standaloneEvaluationWorker,
    finalizationWorker,
    reportWorker,
    emailWorker,
  ];
  for (const worker of workers) {
    worker.on("error", (error) => {
      console.error("[jobs] Worker error:", error.message);
    });
  }

  void Promise.all(workers.map((worker) => worker.waitUntilReady()))
    .then(() => recoverPendingInterviewJobs())
    .then((count) => console.log(`[jobs] Workers ready; recovered ${count} pending interview session(s)`))
    .catch((error) => {
      console.error("[jobs] Worker startup or interview recovery failed:", error);
    });
};

export const closeBackgroundWorkers = async (): Promise<void> => {
  await Promise.all(workers.map((worker) => worker.close()));
  workers = [];
};
