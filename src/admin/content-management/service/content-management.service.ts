import { Job } from "../../../shared/job/model/job.model";
import { Application } from "../../../shared/application/model/application.model";
import { AppError } from "../../../utils/AppError";
import { logActivity } from "../../activity-log/service/activity-log.service";

export const listAllJobs = async () => {
  return Job.find().populate("hrId", "name email").sort({ createdAt: -1 });
};

export const closeJob = async (adminId: string, jobId: string) => {
  const job = await Job.findById(jobId);
  if (!job) {
    throw new AppError("Job not found", 404);
  }
  job.status = "closed";
  await job.save();
  await logActivity(adminId, "admin", "job.close", "Job", jobId);
  return job;
};

export const deleteJob = async (adminId: string, jobId: string) => {
  const job = await Job.findById(jobId);
  if (!job) {
    throw new AppError("Job not found", 404);
  }
  await Job.deleteOne({ _id: jobId });
  await logActivity(adminId, "admin", "job.delete", "Job", jobId, { title: job.title });
};

export const listAllApplications = async () => {
  return Application.find()
    .populate("candidateId", "name email")
    .populate("jobId", "title")
    .sort({ createdAt: -1 });
};
