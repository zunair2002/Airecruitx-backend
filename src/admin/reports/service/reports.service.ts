import { User } from "../../../shared/user/model/user.model";
import { Job } from "../../../shared/job/model/job.model";
import { Application } from "../../../shared/application/model/application.model";

export const getReportsSummary = async () => {
  const [usersByRole, applicationsByStatus, jobsByStatus, matchScoreAgg] = await Promise.all([
    User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
    Application.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Job.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Application.aggregate([{ $group: { _id: null, avgMatchScore: { $avg: "$matchScore" } } }]),
  ]);

  return {
    usersByRole,
    applicationsByStatus,
    jobsByStatus,
    averageMatchScore: matchScoreAgg[0]?.avgMatchScore ?? 0,
  };
};
