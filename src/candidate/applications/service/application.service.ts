import axios from "axios";
import {
  Application,
  IApplication,
  OrgInterviewViolationType,
} from "../../../shared/application/model/application.model";
import { Job } from "../../../shared/job/model/job.model";
import { User } from "../../../shared/user/model/user.model";
import { Resume } from "../../resume/model/resume.model";
import { AppError } from "../../../utils/AppError";
import { getSettings } from "../../../admin/settings/service/settings.service";
import * as interviewService from "../../interview/service/interview.service";
import { IInterviewSession, InterviewSession } from "../../interview/model/interviewSession.model";
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

  // The AI interview is NOT started here. A matched applicant waits for HR to
  // approve them (schedule / bulk trigger), which creates the session and emails
  // the candidate the interview link.

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
  if (status === "cancelled") {
    throw new AppError("This interview was cancelled and can no longer be taken", 409);
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
//
// Once the interview is finished (completed, or cancelled by proctoring/HR) the link
// keeps working but returns a status summary only — when it was invited, started and
// completed/cancelled. Never the questions, answers or scores: those are HR's alone.
export const getOrgInterviewInvite = async (token: string) => {
  const found = await Application.findOne({ "orgInterview.token": token });
  const finished = found && ["completed", "cancelled"].includes(found.orgInterview.status ?? "");
  const application = finished ? found : await resolveActiveOrgInterviewInvite(token);
  const [candidate, job] = await Promise.all([
    User.findById(application.candidateId),
    Job.findById(application.jobId),
  ]);
  const org = application.orgInterview;

  return {
    candidateName: candidate?.name,
    jobTitle: job?.title,
    status: org.status,
    expiresAt: org.expiresAt,
    calendarLink: finished ? undefined : org.calendarLink,
    started: Boolean(application.orgInterviewSessionId),
    invitedAt: org.invitedAt,
    startedAt: org.startedAt,
    completedAt: org.completedAt,
    cancelledAt: org.cancelledAt,
    cancelReason: org.cancelReason,
    violationCount: org.violations?.length ?? 0,
    maxViolations: MAX_ORG_INTERVIEW_VIOLATIONS,
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
// both questions and criteria. Falls back to the AI-generated question flow (same as
// practice/the auto-triggered AI interview) when no question set exists yet, so
// inviting candidates never breaks just because HR hasn't authored questions.
export const startOrgInterviewByToken = async (token: string): Promise<IInterviewSession> => {
  const application = await resolveActiveOrgInterviewInvite(token);
  const candidateId = application.candidateId.toString();

  if (application.orgInterviewSessionId) {
    const existing = await interviewService.getSession(candidateId, application.orgInterviewSessionId.toString());
    // A cancelled session can't be resumed; reaching here means HR re-invited the
    // candidate (the invite is active again), so start them on a fresh session.
    if (!existing.cancelledAt) return existing;
  }

  const [job, questionSet] = await Promise.all([
    Job.findById(application.jobId),
    OrgInterviewQuestionSet.findOne({ jobId: application.jobId }),
  ]);

  const session = questionSet
    ? await interviewService.startStructuredInterview(candidateId, application._id.toString(), questionSet)
    : await interviewService.startInterview(candidateId, application._id.toString(), {
        jobTitle: job?.title,
        requiredSkills: job?.requiredSkills,
        visibility: "hidden",
      });

  application.orgInterviewSessionId = session._id as any;
  application.orgInterview.startedAt = new Date();
  await application.save();

  return session;
};

// Submits an answer for the token-authenticated org interview. On completion, marks
// the invite itself "completed" so HR can tell at a glance (without opening the
// report) which invited candidates actually finished before their link expired.
export const submitOrgInterviewAnswerByToken = async (
  token: string,
  answer: string,
  expectedQuestionNumber?: number
): Promise<IInterviewSession> => {
  const application = await resolveActiveOrgInterviewInvite(token);
  if (!application.orgInterviewSessionId) {
    throw new AppError("Start the interview before submitting an answer", 400);
  }

  const session = await interviewService.submitAnswer(
    application.candidateId.toString(),
    application.orgInterviewSessionId.toString(),
    answer,
    expectedQuestionNumber
  );

  if ((session.status === "completed" || session.status === "expired") && application.orgInterview.status !== "completed") {
    application.orgInterview.status = "completed";
    application.orgInterview.completedAt = new Date();
    await application.save();
  }

  return session;
};

// ---------------------------------------------------------------- proctoring
// Policy agreed with the client: the first two violations only warn the candidate;
// the third cancels the interview. The server — not the browser — counts and decides,
// so a tampered client can't skip the cancellation.
export const MAX_ORG_INTERVIEW_VIOLATIONS = 3;
export const ORG_INTERVIEW_VIOLATION_TYPES: OrgInterviewViolationType[] = [
  "tab_hidden",
  "window_blur",
  "fullscreen_exit",
  "camera_off",
];
// Switching tabs fires both visibilitychange and blur — collapse near-simultaneous
// reports into one violation.
const VIOLATION_DEDUPE_MS = 2000;

// Ends an org interview early: flips the invite to "cancelled" and stamps the session
// so no further answers are accepted through either answer endpoint. Exported so the
// HR side can reuse it (cancelledBy: "hr").
export const cancelOrgInterview = async (
  application: IApplication,
  reason: string,
  cancelledBy: "proctoring" | "hr"
): Promise<IApplication> => {
  const now = new Date();
  application.orgInterview.status = "cancelled";
  application.orgInterview.cancelledAt = now;
  application.orgInterview.cancelReason = reason;
  application.orgInterview.cancelledBy = cancelledBy;
  await application.save();

  if (application.orgInterviewSessionId) {
    await InterviewSession.updateOne(
      { _id: application.orgInterviewSessionId, cancelledAt: { $exists: false } },
      { $set: { cancelledAt: now, cancelReason: reason } }
    );
  }
  return application;
};

const violationState = (application: IApplication) => ({
  status: application.orgInterview.status,
  violationCount: application.orgInterview.violations?.length ?? 0,
  maxViolations: MAX_ORG_INTERVIEW_VIOLATIONS,
  cancelled: application.orgInterview.status === "cancelled",
  cancelReason: application.orgInterview.cancelReason,
});

export const reportOrgInterviewViolation = async (token: string, type: OrgInterviewViolationType) => {
  const current = await resolveActiveOrgInterviewInvite(token);
  if (!current.orgInterviewSessionId) {
    throw new AppError("Start the interview before reporting proctoring events", 400);
  }

  const now = new Date();
  const last = current.orgInterview.violations?.at(-1);
  if (last && now.getTime() - new Date(last.at).getTime() < VIOLATION_DEDUPE_MS) {
    return violationState(current);
  }

  // Atomic push guarded on "invited" so concurrent reports can't both slip past a
  // cancellation that just happened.
  const application = await Application.findOneAndUpdate(
    { _id: current._id, "orgInterview.status": "invited" },
    { $push: { "orgInterview.violations": { type, at: now } } },
    { new: true }
  );
  if (!application) {
    throw new AppError("This interview is no longer active", 409);
  }

  const count = application.orgInterview.violations?.length ?? 0;
  if (count >= MAX_ORG_INTERVIEW_VIOLATIONS) {
    const kinds = [...new Set((application.orgInterview.violations ?? []).map((v) => v.type))].join(", ");
    await cancelOrgInterview(
      application,
      `Cancelled automatically after ${count} proctoring violations (${kinds}).`,
      "proctoring"
    );
  }

  return violationState(application);
};

// Candidate-side cancel through the invite link (e.g. their camera can't be
// restored). Same effect as the automatic proctoring cancellation.
export const cancelOrgInterviewByToken = async (token: string, reason?: string) => {
  const application = await resolveActiveOrgInterviewInvite(token);
  await cancelOrgInterview(
    application,
    reason?.trim().slice(0, 300) || "Cancelled from the candidate's interview link.",
    "proctoring"
  );
  return violationState(application);
};
