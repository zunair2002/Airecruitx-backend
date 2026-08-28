import axios from "axios";
import { Application, IApplication } from "../../../shared/application/model/application.model";
import { Job } from "../../../shared/job/model/job.model";
import { User } from "../../../shared/user/model/user.model";
import { Resume } from "../../resume/model/resume.model";
import { AppError } from "../../../utils/AppError";
import { getSettings } from "../../../admin/settings/service/settings.service";
import * as interviewService from "../../interview/service/interview.service";
import { IInterviewSession } from "../../interview/model/interviewSession.model";
import { OrgInterviewQuestionSet } from "../../../hr/job-posting/model/orgInterviewQuestionSet.model";
import { extractTextFromFile } from "../../../shared/util/extractTextFromFile";

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

// The resume's extracted text is never stored (see resume.model.ts) — it's re-fetched
// from Cloudinary and re-parsed here, on demand, each time a match score is needed.
const getResumeText = async (fileUrl: string, mimeType: string): Promise<string> => {
  const response = await axios.get<ArrayBuffer>(fileUrl, { responseType: "arraybuffer" });
  return extractTextFromFile(Buffer.from(response.data), mimeType);
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

  const [settings, resumeText] = await Promise.all([
    getSettings(),
    getResumeText(resume.fileUrl, resume.mimeType),
  ]);
  const { matchScore, matchedSkills } = matchAgainstRequiredSkills(resumeText, job.requiredSkills);
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

// The org-interview flow below is deliberately token-authenticated rather than
// requireAuth-gated: the candidate reaches it straight from an emailed link (possibly
// on a different device than the one they're logged in on), with no fixed appointment
// time to plan around — the link itself, not a login session, is the credential, the
// same pattern most take-home/on-demand interview tools use.

// Looks up the application by its org-interview token and enforces the invite is still
// usable. Expiry is checked directly against `expiresAt` (not just the stored
// `status`) so this is correct even in the up-to-a-minute gap before the periodic
// expiry sweep (src/config/orgInterviewExpiryScheduler.ts) has flipped the status.
const resolveActiveOrgInterviewInvite = async (token: string): Promise<IApplication> => {
  const application = await Application.findOne({ "orgInterview.token": token });
  if (!application) {
    throw new AppError("This interview link is invalid", 404);
  }

  const { status, expiresAt } = application.orgInterview;

  if (status === "completed") {
    throw new AppError("This interview has already been completed", 409);
  }
  if (status === "expired" || (expiresAt && expiresAt.getTime() < Date.now())) {
    if (status !== "expired") {
      application.orgInterview.status = "expired";
      await application.save();
    }
    throw new AppError("This interview link has expired", 410);
  }

  return application;
};

// For a landing page before the candidate commits to starting — confirms the link is
// valid and shows what it's for, without creating the interview session yet.
export const getOrgInterviewInvite = async (token: string) => {
  const application = await resolveActiveOrgInterviewInvite(token);
  const [candidate, job] = await Promise.all([
    User.findById(application.candidateId),
    Job.findById(application.jobId),
  ]);

  return {
    candidateName: candidate?.name,
    jobTitle: job?.title,
    expiresAt: application.orgInterview.expiresAt,
    calendarLink: application.orgInterview.calendarLink,
    started: Boolean(application.orgInterviewSessionId),
  };
};

// Called when the candidate opens their invite link and chooses to begin. Creates the
// session at this point — not when HR sent the invite — so the opening question is
// fresh no matter when within the validity window they arrive; reuses the existing
// one if they resume (idempotent). The session is "hidden" visibility: the candidate
// can answer questions but never sees feedback/score/result, which is for HR only.
//
// If HR has authored a question set for this job (see orgInterviewQuestionSet), the
// interview asks exactly those questions and grades each answer against HR's own
// reference answer/marks — a controlled evaluator rather than the AI freely inventing
// both questions and criteria. Falls back to the free-form Ollama flow (same as
// practice/the auto-triggered AI interview) when no question set exists yet, so
// inviting candidates never breaks just because HR hasn't authored questions.
export const startOrgInterviewByToken = async (token: string): Promise<IInterviewSession> => {
  const application = await resolveActiveOrgInterviewInvite(token);
  const candidateId = application.candidateId.toString();

  if (application.orgInterviewSessionId) {
    return interviewService.getSession(candidateId, application.orgInterviewSessionId.toString());
  }

  const [job, questionSet] = await Promise.all([
    Job.findById(application.jobId),
    OrgInterviewQuestionSet.findOne({ jobId: application.jobId }),
  ]);

  const session = questionSet
    ? await interviewService.startStructuredInterview(candidateId, application._id.toString(), questionSet)
    : await interviewService.startInterview(candidateId, application._id.toString(), {
        jobTitle: job?.title,
        visibility: "hidden",
      });

  application.orgInterviewSessionId = session._id as any;
  await application.save();

  return session;
};

// Submits an answer for the token-authenticated org interview. On completion, marks
// the invite itself "completed" so HR can tell at a glance (without opening the
// report) which invited candidates actually finished before their link expired.
export const submitOrgInterviewAnswerByToken = async (
  token: string,
  answer: string
): Promise<IInterviewSession> => {
  const application = await resolveActiveOrgInterviewInvite(token);
  if (!application.orgInterviewSessionId) {
    throw new AppError("Start the interview before submitting an answer", 400);
  }

  const session = await interviewService.submitAnswer(
    application.candidateId.toString(),
    application.orgInterviewSessionId.toString(),
    answer
  );

  if (session.status === "completed" && application.orgInterview.status !== "completed") {
    application.orgInterview.status = "completed";
    application.orgInterview.completedAt = new Date();
    await application.save();
  }

  return session;
};
