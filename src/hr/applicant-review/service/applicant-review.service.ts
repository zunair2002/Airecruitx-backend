import crypto from "crypto";
import { Types } from "mongoose";
import { Application, IApplication, ApplicationStatus } from "../../../shared/application/model/application.model";
import { Job } from "../../../shared/job/model/job.model";
import { User } from "../../../shared/user/model/user.model";
import { InterviewSession } from "../../../candidate/interview/model/interviewSession.model";
import * as interviewService from "../../../candidate/interview/service/interview.service";
import { AppError } from "../../../utils/AppError";
import { emitToUser } from "../../../config/socket";
import { sendOrgInterviewInvite } from "../../../shared/email/email.service";

const requireOwnedJob = async (hrId: string, jobId: string) => {
  const job = await Job.findOne({ _id: jobId, hrId });
  if (!job) {
    throw new AppError("Job not found", 404);
  }
  return job;
};

// Enriches each application with its AI-interview and org-interview scores (only once
// each session is completed) so HR's applicant table can show "ATS match % + AI score"
// side by side without a separate report call per row.
const attachInterviewScores = async (applications: IApplication[]) => {
  const sessionIds = applications
    .flatMap((a) => [a.interviewSessionId, a.orgInterviewSessionId])
    .filter((id): id is Types.ObjectId => Boolean(id));

  const sessions = sessionIds.length
    ? await InterviewSession.find({ _id: { $in: sessionIds } }, "status score result")
    : [];
  const sessionById = new Map(sessions.map((s) => [s._id.toString(), s]));

  return applications.map((application) => {
    const aiSession = application.interviewSessionId && sessionById.get(application.interviewSessionId.toString());
    const orgSession =
      application.orgInterviewSessionId && sessionById.get(application.orgInterviewSessionId.toString());

    const obj = application.toObject() as IApplication & {
      aiInterviewScore?: number;
      aiInterviewResult?: string;
      orgInterviewScore?: number;
      orgInterviewResult?: string;
    };
    if (aiSession?.status === "completed") {
      obj.aiInterviewScore = aiSession.score;
      obj.aiInterviewResult = aiSession.result;
    }
    if (orgSession?.status === "completed") {
      obj.orgInterviewScore = orgSession.score;
      obj.orgInterviewResult = orgSession.result;
    }
    return obj;
  });
};

// minMatchScore lets HR filter straight to e.g. "80%+ match" instead of fetching every
// applicant and filtering client-side — the same matchScore already computed at apply time.
export const listApplicationsForJob = async (hrId: string, jobId: string, minMatchScore?: number) => {
  await requireOwnedJob(hrId, jobId);
  const filter: Record<string, unknown> = { jobId };
  if (minMatchScore !== undefined) filter.matchScore = { $gte: minMatchScore };
  const applications = await Application.find(filter).populate("candidateId", "name email").sort({ matchScore: -1 });
  return attachInterviewScores(applications);
};

export const listMatchedApplicationsForJob = async (hrId: string, jobId: string, minMatchScore?: number) => {
  await requireOwnedJob(hrId, jobId);
  const filter: Record<string, unknown> = { jobId, matched: true };
  if (minMatchScore !== undefined) filter.matchScore = { $gte: minMatchScore };
  const applications = await Application.find(filter).populate("candidateId", "name email").sort({ matchScore: -1 });
  return attachInterviewScores(applications);
};

export const getApplicationReport = async (hrId: string, applicationId: string) => {
  const application = await Application.findById(applicationId).populate("candidateId", "name email");
  if (!application) {
    throw new AppError("Application not found", 404);
  }
  await requireOwnedJob(hrId, application.jobId.toString());

  const [interviewSession, orgInterviewSession] = await Promise.all([
    application.interviewSessionId ? InterviewSession.findById(application.interviewSessionId) : null,
    application.orgInterviewSessionId
      ? InterviewSession.findById(application.orgInterviewSessionId)
      : null,
  ]);

  return { application, interviewSession, orgInterviewSession };
};

const assertHrOwnsApplication = async (hrId: string, applicationId: string): Promise<IApplication> => {
  const application = await Application.findById(applicationId);
  if (!application) {
    throw new AppError("Application not found", 404);
  }
  await requireOwnedJob(hrId, application.jobId.toString());
  return application;
};

export const updateApplicationStatus = async (
  hrId: string,
  applicationId: string,
  status: ApplicationStatus
): Promise<IApplication> => {
  if (!["pending", "selected", "rejected"].includes(status)) {
    throw new AppError("Invalid status", 400);
  }

  const application = await assertHrOwnsApplication(hrId, applicationId);
  application.status = status;
  await application.save();

  emitToUser(application.candidateId.toString(), "application:status", {
    applicationId: application._id,
    jobId: application.jobId,
    status: application.status,
  });

  return application;
};

// Lets HR shortlist/reject several applicants at once instead of one at a time.
export const bulkUpdateApplicationStatus = async (
  hrId: string,
  applicationIds: string[],
  status: ApplicationStatus
): Promise<IApplication[]> => {
  const results: IApplication[] = [];
  for (const applicationId of applicationIds) {
    results.push(await updateApplicationStatus(hrId, applicationId, status));
  }
  return results;
};

const INTERVIEW_DURATION_MINUTES = 30;

// Formats a Date as the compact UTC form Google Calendar's URL API expects (YYYYMMDDTHHMMSSZ).
const toGoogleCalendarDate = (date: Date): string => date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

// Builds a plain "Add to Google Calendar" link — no OAuth/API credentials needed,
// the candidate just clicks it to add the event to their own calendar.
const buildGoogleCalendarLink = (jobTitle: string, dateTime: Date, message?: string): string => {
  const start = toGoogleCalendarDate(dateTime);
  const end = toGoogleCalendarDate(new Date(dateTime.getTime() + INTERVIEW_DURATION_MINUTES * 60_000));

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `AI Interview — ${jobTitle}`,
    dates: `${start}/${end}`,
    details: message || "Your AI interview slot for this application.",
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

interface ScheduleAiInterviewInput {
  dateTime: string;
  message?: string;
}

export const scheduleAiInterview = async (
  hrId: string,
  applicationId: string,
  input: ScheduleAiInterviewInput
): Promise<IApplication> => {
  const application = await assertHrOwnsApplication(hrId, applicationId);
  const job = await requireOwnedJob(hrId, application.jobId.toString());

  if (!application.matched) {
    throw new AppError("Only matched applicants can have an AI interview scheduled", 400);
  }
  if (!input.dateTime) {
    throw new AppError("dateTime is required", 400);
  }

  const dateTime = new Date(input.dateTime);
  const calendarLink = buildGoogleCalendarLink(job.title, dateTime, input.message);

  // Creates (or reuses, if already created) the real interview session tied to this
  // application — separate from the candidate's private practice sessions.
  const session = await interviewService.startInterview(
    application.candidateId.toString(),
    applicationId,
    { jobTitle: job.title, requiredSkills: job.requiredSkills }
  );
  application.interviewSessionId = session._id as any;

  application.aiInterview = {
    scheduled: true,
    dateTime,
    message: input.message,
    calendarLink,
  };
  await application.save();

  emitToUser(application.candidateId.toString(), "application:ai-interview-scheduled", {
    applicationId: application._id,
    jobId: application.jobId,
    aiInterview: application.aiInterview,
    interviewSessionId: application.interviewSessionId,
  });

  return application;
};

const DEFAULT_ORG_INTERVIEW_VALIDITY_DAYS = 2;

const buildOrgInterviewLink = (token: string): string => {
  const appBaseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  return `${appBaseUrl}/candidate/interview/org?token=${token}`;
};

// Formats a Date as the YYYYMMDD form Google Calendar's URL API expects for all-day events.
const toGoogleCalendarAllDayDate = (date: Date): string => date.toISOString().slice(0, 10).replace(/-/g, "");

// Unlike buildGoogleCalendarLink above (a single fixed slot), this is an all-day event
// spanning the whole validity window — there's no fixed time, just a "take it sometime
// in this range" deadline, so an all-day range reads more honestly than a fake time slot.
const buildOrgInterviewCalendarLink = (
  jobTitle: string,
  invitedAt: Date,
  expiresAt: Date,
  joinLink: string
): string => {
  const start = toGoogleCalendarAllDayDate(invitedAt);
  // Google's all-day end date is exclusive, so bump it a day past expiresAt's date
  // to make sure the actual expiry day itself is still shown as part of the range.
  const endExclusive = new Date(expiresAt);
  endExclusive.setDate(endExclusive.getDate() + 1);
  const end = toGoogleCalendarAllDayDate(endExclusive);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `AI Interview available — ${jobTitle}`,
    dates: `${start}/${end}`,
    details: `Complete your AI interview for ${jobTitle} anytime before ${expiresAt.toLocaleString()}.\n${joinLink}`,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

// Invites a candidate to a self-paced AI interview: generates a unique token good for
// `validityDays` (default 2), emails them the link, and leaves the actual interview
// session uncreated until they open it (see application.service.ts's
// startOrgInterviewByToken) — so the opening question is fresh whenever they arrive,
// not stale from invite time.
export const inviteToOrgInterview = async (
  hrId: string,
  applicationId: string,
  validityDays: number = DEFAULT_ORG_INTERVIEW_VALIDITY_DAYS
): Promise<IApplication> => {
  const application = await assertHrOwnsApplication(hrId, applicationId);

  if (application.status !== "selected") {
    throw new AppError("Only selected candidates can be invited to an organizational interview", 400);
  }
  if (!Number.isFinite(validityDays) || validityDays <= 0) {
    throw new AppError("validityDays must be a positive number", 400);
  }

  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
  const joinLink = buildOrgInterviewLink(token);

  const job = await Job.findById(application.jobId);
  const calendarLink = buildOrgInterviewCalendarLink(job?.title ?? "your interview", now, expiresAt, joinLink);

  application.orgInterview = {
    status: "invited",
    token,
    expiresAt,
    invitedAt: now,
    calendarLink,
    notes: application.orgInterview?.notes,
  };
  await application.save();

  // Best-effort: a failed invite email shouldn't block the invite itself — HR can
  // still see (and candidates could theoretically be given) the link in-app.
  try {
    const candidate = await User.findById(application.candidateId);
    if (candidate && job) {
      await sendOrgInterviewInvite(
        candidate.email,
        candidate.name,
        job.title,
        joinLink,
        expiresAt,
        calendarLink
      );
    }
  } catch (error) {
    console.error(`[inviteToOrgInterview] Failed to send invite email for application ${applicationId}:`, error);
  }

  emitToUser(application.candidateId.toString(), "application:org-interview", {
    applicationId: application._id,
    jobId: application.jobId,
    orgInterview: { status: application.orgInterview.status, expiresAt: application.orgInterview.expiresAt },
  });

  return application;
};

// The core "filter by match score, select many, invite them all at once" flow this
// feature exists for — one broadcast action instead of scheduling candidates one by one.
export const bulkInviteToOrgInterview = async (
  hrId: string,
  applicationIds: string[],
  validityDays?: number
): Promise<IApplication[]> => {
  const results: IApplication[] = [];
  for (const applicationId of applicationIds) {
    results.push(await inviteToOrgInterview(hrId, applicationId, validityDays));
  }
  return results;
};

// Manually (re)triggers the AI interview for several matched applicants at once —
// mainly useful when the automatic trigger at apply-time failed (e.g. the interview
// model was briefly unreachable). Applicants that aren't matched, or already have an
// AI interview session, are left untouched rather than erroring the whole batch.
export const bulkTriggerAiInterview = async (
  hrId: string,
  applicationIds: string[]
): Promise<IApplication[]> => {
  const results: IApplication[] = [];
  for (const applicationId of applicationIds) {
    const application = await assertHrOwnsApplication(hrId, applicationId);
    if (!application.matched || application.interviewSessionId) {
      results.push(application);
      continue;
    }

    const job = await requireOwnedJob(hrId, application.jobId.toString());
    try {
      const session = await interviewService.startInterview(
        application.candidateId.toString(),
        applicationId,
        { jobTitle: job.title, requiredSkills: job.requiredSkills }
      );
      application.interviewSessionId = session._id as any;
      application.aiInterview = { scheduled: true, dateTime: new Date() };
      await application.save();
    } catch (error) {
      console.error(`[bulkTriggerAiInterview] Failed to start AI interview for application ${applicationId}:`, error);
    }
    results.push(application);
  }
  return results;
};
