import { randomUUID } from "crypto";
import { Job, JobsOptions, Queue, QueueEvents } from "bullmq";
import Redis from "ioredis";
import { AppError } from "../utils/AppError";
import type {
  AnswerEvaluation,
  ReportResultLine,
  ReportText,
} from "../ai/ai.service";

export interface AnswerEvaluationJob {
  sessionId: string;
  questionNumber: number;
}

export interface StandaloneAnswerEvaluationJob {
  stage: "basic" | "technical";
  level?: string;
  topic: string;
  question: string;
  keyPoints: string[];
  answer: string;
}

export interface InterviewFinalizationJob {
  sessionId: string;
  timeUp: boolean;
}

export interface ReportGenerationJob {
  sessionId: string;
  report: {
    reportType: "candidate" | "hr";
    role: string;
    level: string;
    basicScore: number;
    technicalScore: number;
    overall: number;
    decision: string;
    results: ReportResultLine[];
    passMark10: number;
  };
}

export type EmailDeliveryJob =
  | { kind: "otp"; to: string; name: string; otp: string }
  | {
      kind: "org-interview-invite";
      to: string;
      candidateName: string;
      jobTitle: string;
      applicationId: string;
      inviteToken: string;
      joinLink: string;
      expiresAt: string;
      calendarLink: string;
    };

const QUEUE_NAMES = {
  evaluations: "interview-answer-evaluations",
  standaloneEvaluations: "standalone-answer-evaluations",
  finalizations: "interview-finalizations",
  reports: "interview-report-generation",
  emails: "email-delivery",
} as const;

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10_000 },
  removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 },
};

const newRedisConnection = (blocking: boolean): Redis => {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new AppError("Persistent background jobs require REDIS_URL to be configured", 503);
  }
  const connection = new Redis(url, {
    maxRetriesPerRequest: blocking ? null : 1,
    enableOfflineQueue: blocking,
    connectTimeout: 5000,
    retryStrategy: (times) => Math.min(times * 1000, 10_000),
  });
  connection.on("error", (error) => {
    console.error("[jobs] Redis connection error:", error.message);
  });
  return connection;
};

let evaluationsQueue: Queue<AnswerEvaluationJob> | undefined;
let standaloneEvaluationsQueue: Queue<StandaloneAnswerEvaluationJob> | undefined;
let finalizationsQueue: Queue<InterviewFinalizationJob> | undefined;
let reportsQueue: Queue<ReportGenerationJob> | undefined;
let emailsQueue: Queue<EmailDeliveryJob> | undefined;
let finalizationsEvents: QueueEvents | undefined;
let reportsEvents: QueueEvents | undefined;
let standaloneEvaluationsEvents: QueueEvents | undefined;

const createQueue = <T>(name: string): Queue<T> =>
  new Queue<T>(name, { connection: newRedisConnection(false), defaultJobOptions });

const waitForEventsReady = async (events: QueueEvents): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      events.waitUntilReady(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new AppError("The background job service is unavailable. Please try again.", 503)),
          10_000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const enqueue = async (
  queue: Queue,
  name: string,
  data: object,
  options?: JobsOptions,
): Promise<Job> => {
  try {
    return await queue.add(name, data, options);
  } catch (error) {
    console.error(`[jobs] Failed to enqueue ${name}:`, error);
    throw new AppError("The background job service is unavailable. Please try again.", 503);
  }
};

export const enqueueAnswerEvaluation = async (
  data: AnswerEvaluationJob,
  retryToken?: string,
): Promise<Job<AnswerEvaluationJob>> => {
  evaluationsQueue ??= createQueue<AnswerEvaluationJob>(QUEUE_NAMES.evaluations);
  const suffix = retryToken ? `-${retryToken}` : "";
  const jobId = `answer-${data.sessionId}-${data.questionNumber}${suffix}`;
  try {
    const existing = await evaluationsQueue.getJob(jobId);
    if (existing) {
      if (await existing.getState() === "failed") await existing.retry("failed");
      return existing;
    }
    return await enqueue(evaluationsQueue, "evaluate-answer", data, { jobId, attempts: 1 });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("[jobs] Failed to schedule answer evaluation:", error);
    throw new AppError("The background job service is unavailable. Please try again.", 503);
  }
};

export const enqueueAndWaitForStandaloneEvaluation = async (
  data: StandaloneAnswerEvaluationJob,
): Promise<AnswerEvaluation> => {
  standaloneEvaluationsQueue ??= createQueue<StandaloneAnswerEvaluationJob>(
    QUEUE_NAMES.standaloneEvaluations,
  );
  const job = await enqueue(
    standaloneEvaluationsQueue,
    "evaluate-standalone-answer",
    data,
    { jobId: randomUUID(), attempts: 1 },
  );
  standaloneEvaluationsEvents ??= new QueueEvents(QUEUE_NAMES.standaloneEvaluations, {
    connection: newRedisConnection(true),
  });
  await waitForEventsReady(standaloneEvaluationsEvents);
  return job.waitUntilFinished(standaloneEvaluationsEvents, 10 * 60_000);
};

export const enqueueInterviewFinalization = async (
  data: InterviewFinalizationJob,
): Promise<Job<InterviewFinalizationJob>> => {
  finalizationsQueue ??= createQueue<InterviewFinalizationJob>(QUEUE_NAMES.finalizations);
  const jobId = `finalize-${data.sessionId}`;
  try {
    const existing = await finalizationsQueue.getJob(jobId);
    if (existing) {
      if (await existing.getState() === "failed") await existing.retry("failed");
      return existing;
    }
    return await enqueue(finalizationsQueue, "finalize-interview", data, { jobId });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("[jobs] Failed to schedule interview finalization:", error);
    throw new AppError("The background job service is unavailable. Please try again.", 503);
  }
};

export const waitForInterviewFinalization = async (
  job: Job<InterviewFinalizationJob>,
  timeoutMs: number,
): Promise<void> => {
  finalizationsEvents ??= new QueueEvents(QUEUE_NAMES.finalizations, {
    connection: newRedisConnection(true),
  });
  await waitForEventsReady(finalizationsEvents);
  await job.waitUntilFinished(finalizationsEvents, timeoutMs);
};

export const enqueueReportGeneration = async (
  data: ReportGenerationJob,
): Promise<ReportText> => {
  reportsQueue ??= createQueue<ReportGenerationJob>(QUEUE_NAMES.reports);
  const jobId = `report-${data.sessionId}`;
  let job: Job<ReportGenerationJob>;
  try {
    const existing = await reportsQueue.getJob(jobId);
    if (existing) {
      if (await existing.getState() === "failed") await existing.retry("failed");
      job = existing;
    } else {
      job = await enqueue(reportsQueue, "generate-report", data, { jobId, attempts: 1 });
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("[jobs] Failed to schedule report generation:", error);
    throw new AppError("The background job service is unavailable. Please try again.", 503);
  }
  reportsEvents ??= new QueueEvents(QUEUE_NAMES.reports, {
    connection: newRedisConnection(true),
  });
  await waitForEventsReady(reportsEvents);
  return job.waitUntilFinished(reportsEvents, 10 * 60_000);
};

export const enqueueEmailDelivery = (data: EmailDeliveryJob): Promise<Job<EmailDeliveryJob>> => {
  emailsQueue ??= createQueue<EmailDeliveryJob>(QUEUE_NAMES.emails);
  return enqueue(emailsQueue, `send-${data.kind}`, data, {
    jobId: randomUUID(),
    removeOnComplete: true,
    removeOnFail: { age: 60 * 60, count: 1000 },
  });
};

export const closeJobQueues = async (): Promise<void> => {
  await Promise.all([
    evaluationsQueue?.close(),
    standaloneEvaluationsQueue?.close(),
    finalizationsQueue?.close(),
    reportsQueue?.close(),
    emailsQueue?.close(),
    finalizationsEvents?.close(),
    reportsEvents?.close(),
    standaloneEvaluationsEvents?.close(),
  ]);
};

export const jobQueueNames = QUEUE_NAMES;
export const jobDefaults = defaultJobOptions;
