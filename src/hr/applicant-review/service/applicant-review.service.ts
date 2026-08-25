import { Application, IApplication, ApplicationStatus } from "../../../shared/application/model/application.model";
import { Job } from "../../../shared/job/model/job.model";
import { User } from "../../../shared/user/model/user.model";
import { InterviewSession } from "../../../candidate/interview/model/interviewSession.model";
import * as interviewService from "../../../candidate/interview/service/interview.service";
import { AppError } from "../../../utils/AppError";
import { emitToUser } from "../../../config/socket";
import { sendOrgInterviewConfirmation } from "../../../shared/email/email.service";

const requireOwnedJob = async (hrId: string, jobId: string) => {
  const job = await Job.findOne({ _id: jobId, hrId });
  if (!job) {
    throw new AppError("Job not found", 404);
  }
  return job;
};

export const listApplicationsForJob = async (hrId: string, jobId: string) => {
  await requireOwnedJob(hrId, jobId);
  return Application.find({ jobId })
    .populate("candidateId", "name email")
    .sort({ matchScore: -1 });
};

export const listMatchedApplicationsForJob = async (hrId: string, jobId: string) => {
  await requireOwnedJob(hrId, jobId);
  return Application.find({ jobId, matched: true })
    .populate("candidateId", "name email")
    .sort({ matchScore: -1 });
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
    { jobTitle: job.title }
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

interface ScheduleOrgInterviewInput {
  dateTime: string;
  location?: string;
  notes?: string;
}

// The organizational interview's actual AI session is NOT created here — only when
// the candidate opens the join link at interview time (see application.service.ts's
// startOrgInterview), so the opening question is fresh rather than stale by the time
// they arrive. This just books the slot and emails a confirmation; the reminder
// scheduler (src/config/reminderScheduler.ts) sends the join-link email later.
export const scheduleOrgInterview = async (
  hrId: string,
  applicationId: string,
  input: ScheduleOrgInterviewInput
): Promise<IApplication> => {
  const application = await assertHrOwnsApplication(hrId, applicationId);

  if (application.status !== "selected") {
    throw new AppError("Only selected candidates can have an org interview scheduled", 400);
  }
  if (!input.dateTime) {
    throw new AppError("dateTime is required", 400);
  }

  const dateTime = new Date(input.dateTime);

  application.orgInterview = {
    scheduled: true,
    dateTime,
    location: input.location,
    notes: input.notes,
    reminderSent: false,
  };
  await application.save();

  // Best-effort: a failed confirmation email shouldn't block scheduling — the
  // candidate still sees the date in-app and will still get the reminder email.
  try {
    const [candidate, job] = await Promise.all([
      User.findById(application.candidateId),
      Job.findById(application.jobId),
    ]);
    if (candidate && job) {
      await sendOrgInterviewConfirmation(candidate.email, candidate.name, job.title, dateTime);
    }
  } catch (error) {
    console.error(`[scheduleOrgInterview] Failed to send confirmation email for application ${applicationId}:`, error);
  }

  emitToUser(application.candidateId.toString(), "application:org-interview", {
    applicationId: application._id,
    jobId: application.jobId,
    orgInterview: application.orgInterview,
  });

  return application;
};

// Lets HR schedule the same interview slot for several matched-and-selected
// applicants at once instead of repeating the single-candidate flow.
export const bulkScheduleOrgInterview = async (
  hrId: string,
  applicationIds: string[],
  input: ScheduleOrgInterviewInput
): Promise<IApplication[]> => {
  const results: IApplication[] = [];
  for (const applicationId of applicationIds) {
    results.push(await scheduleOrgInterview(hrId, applicationId, input));
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
        { jobTitle: job.title }
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
