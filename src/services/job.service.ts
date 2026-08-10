import { Job, IJob } from "../models/job.model";
import { AppError } from "../utils/AppError";

interface CreateJobInput {
  title: string;
  description: string;
  requiredSkills: string[];
}

const normalizeSkills = (skills: string[]): string[] =>
  Array.from(
    new Set(
      skills
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0)
    )
  );

export const createJob = async (hrId: string, input: CreateJobInput): Promise<IJob> => {
  if (!input.title?.trim()) {
    throw new AppError("Job title is required", 400);
  }
  if (!input.description?.trim()) {
    throw new AppError("Job description is required", 400);
  }
  const requiredSkills = normalizeSkills(input.requiredSkills ?? []);
  if (requiredSkills.length === 0) {
    throw new AppError("At least one required skill is needed", 400);
  }

  return Job.create({
    hrId,
    title: input.title.trim(),
    description: input.description.trim(),
    requiredSkills,
  });
};

export const listOpenJobs = async (): Promise<IJob[]> => {
  return Job.find({ status: "open" }).sort({ createdAt: -1 });
};

export const listJobsForHr = async (hrId: string): Promise<IJob[]> => {
  return Job.find({ hrId }).sort({ createdAt: -1 });
};

export const getJobById = async (jobId: string): Promise<IJob> => {
  const job = await Job.findById(jobId);
  if (!job) {
    throw new AppError("Job not found", 404);
  }
  return job;
};
