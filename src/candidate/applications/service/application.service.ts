import { Application, IApplication } from "../../../shared/application/model/application.model";
import { Job } from "../../../shared/job/model/job.model";
import { Resume } from "../../resume/model/resume.model";
import { AppError } from "../../../utils/AppError";
import { getSettings } from "../../../admin/settings/service/settings.service";
import * as interviewService from "../../interview/service/interview.service";
import { IInterviewSession } from "../../interview/model/interviewSession.model";

// Matches directly against whatever skills HR actually required for this job, searched
// in the candidate's real resume text — not a fixed dictionary. Keeps matching honest to
// what HR asked for instead of being capped by a static skills list.
const matchAgainstRequiredSkills = (
  resumeText: string,
  requiredSkills: string[]
): { matchScore: number; matchedSkills: string[] } => {
  if (requiredSkills.length === 0) return { matchScore: 0, matchedSkills: [] };

  const lowerText = resumeText.toLowerCase();
  const matchedSkills = requiredSkills.filter((skill) => lowerText.includes(skill.toLowerCase()));
  const matchScore = Math.round((matchedSkills.length / requiredSkills.length) * 100);

  return { matchScore, matchedSkills };
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

  const settings = await getSettings();
  const { matchScore, matchedSkills } = matchAgainstRequiredSkills(resume.rawText, job.requiredSkills);
  const matched = matchScore >= settings.matchThreshold;

  let application: IApplication;
  try {
    application = await Application.create({
      jobId,
      candidateId,
      resumeSnapshotSkills: matchedSkills,
      matchScore,
      matched,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      throw new AppError("You have already applied to this job", 409);
    }
    throw error;
  }

  // A match immediately starts the AI interview — no HR action required. Runs after
  // the application is saved so a slow/unreachable interview model never blocks the
  // apply response with a failure; the interview can still be started later.
  if (matched) {
    try {
      const session = await interviewService.startInterview(candidateId, application._id.toString(), {
        jobTitle: job.title,
      });
      application.interviewSessionId = session._id as any;
      application.aiInterview = { scheduled: true, dateTime: new Date() };
      await application.save();
    } catch (error) {
      console.error(`[applyToJob] Failed to auto-start AI interview for application ${application._id}:`, error);
    }
  }

  return application;
};

export const listApplicationsForCandidate = async (candidateId: string) => {
  return Application.find({ candidateId })
    .populate("jobId", "title description")
    .sort({ createdAt: -1 });
};

// Called when the candidate opens the join link (from the confirmation/reminder
// email) for an HR-scheduled organizational interview. Creates the session at this
// point — not when HR schedules it — so the opening question is fresh, and reuses
// the existing one if the candidate re-opens the link (idempotent). The session is
// "hidden" visibility: the candidate can answer questions but never sees feedback/
// score/result, which is for HR only.
export const startOrgInterview = async (
  candidateId: string,
  applicationId: string
): Promise<IInterviewSession> => {
  const application = await Application.findOne({ _id: applicationId, candidateId });
  if (!application) {
    throw new AppError("Application not found", 404);
  }
  if (!application.orgInterview.scheduled) {
    throw new AppError("No organizational interview is scheduled for this application", 400);
  }

  if (application.orgInterviewSessionId) {
    return interviewService.getSession(candidateId, application.orgInterviewSessionId.toString());
  }

  const job = await Job.findById(application.jobId);
  const session = await interviewService.startInterview(candidateId, applicationId, {
    jobTitle: job?.title,
    visibility: "hidden",
  });

  application.orgInterviewSessionId = session._id as any;
  await application.save();

  return session;
};
