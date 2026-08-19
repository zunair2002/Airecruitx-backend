import { Application, IApplication, ApplicationStatus } from "../../../shared/application/model/application.model";
import { Job } from "../../../shared/job/model/job.model";
import { InterviewSession } from "../../../candidate/interview/model/interviewSession.model";
import * as interviewService from "../../../candidate/interview/service/interview.service";
import { AppError } from "../../../utils/AppError";
import { emitToUser } from "../../../config/socket";

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

  const session = application.interviewSessionId
    ? await InterviewSession.findById(application.interviewSessionId)
    : null;

  return { application, interviewSession: session };
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

  application.orgInterview = {
    scheduled: true,
    dateTime: new Date(input.dateTime),
    location: input.location,
    notes: input.notes,
  };
  await application.save();

  emitToUser(application.candidateId.toString(), "application:org-interview", {
    applicationId: application._id,
    jobId: application.jobId,
    orgInterview: application.orgInterview,
  });

  return application;
};
