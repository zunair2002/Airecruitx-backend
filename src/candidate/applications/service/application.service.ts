import { Application, IApplication } from "../../../shared/application/model/application.model";
import { Job } from "../../../shared/job/model/job.model";
import { Resume } from "../../resume/model/resume.model";
import { AppError } from "../../../utils/AppError";
import { getSettings } from "../../../admin/settings/service/settings.service";

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

  // Just applying — no AI interview yet. The application sits in the "waiting list"
  // (matched === true) until HR reviews it and explicitly schedules the AI interview.
  try {
    return await Application.create({
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
};

export const listApplicationsForCandidate = async (candidateId: string) => {
  return Application.find({ candidateId })
    .populate("jobId", "title description")
    .sort({ createdAt: -1 });
};
