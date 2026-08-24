import { Job, IJob } from "../../../shared/job/model/job.model";

export const listOpenJobs = async (): Promise<IJob[]> => {
  return Job.find({ status: "open" }).sort({ createdAt: -1 });
};
