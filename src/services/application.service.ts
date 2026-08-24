import { Application, IApplication, ApplicationStatus } from "../models/application.model";
import { Job } from "../models/job.model";
import { Resume } from "../models/resume.model";
import { InterviewSession } from "../models/interviewSession.model";
import { AppError } from "../utils/AppError";
import { emitToUser } from "../config/socket";
import * as interviewService from "./interview.service";

export const MATCH_THRESHOLD = 50;

const computeMatchScore = (resumeSkills: string[], requiredSkills: string[]): number => {
  if (requiredSkills.length === 0) return 0;
  const resumeSet = new Set(resumeSkills.map((s) => s.toLowerCase()));
  const matchedCount = requiredSkills.filter((skill) => resumeSet.has(skill.toLowerCase())).length;
  return Math.round((matchedCount / requiredSkills.length) * 100);
};

export const applyToJob = async (candidateId: string, jobId: string): Promise<IApplication> => {
  const job = await Job.findById(jobId);
  if (!job || job.status !== "open") {
    throw new AppError("Job not found or no longer open", 404);
  }

  const resume = await Resume.findOne({ userId: candidateId });
  if (!resume) {
    throw new AppError("Upload a resume before applying", 400);
  }

  const matchScore = computeMatchScore(resume.skills, job.requiredSkills);
  const matched = matchScore >= MATCH_THRESHOLD;

  let application: IApplication;
  try {
    application = await Application.create({
      jobId,
      candidateId,
      resumeSnapshotSkills: resume.skills,
      matchScore,
      matched,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      throw new AppError("You have already applied to this job", 409);
    }
    throw error;
  }

  if (matched) {
    const session = await interviewService.startInterview(candidateId, application._id.toString());
    application.interviewSessionId = session._id as any;
    await application.save();
  }

  return application;
};

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

export const listApplicationsForCandidate = async (candidateId: string) => {
  return Application.find({ candidateId })
    .populate("jobId", "title description")
    .sort({ createdAt: -1 });
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
