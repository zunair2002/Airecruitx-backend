import { User } from "../../../shared/user/model/user.model";
import { Job } from "../../../shared/job/model/job.model";
import { Application } from "../../../shared/application/model/application.model";
import { InterviewSession } from "../../../candidate/interview/model/interviewSession.model";
import { AuditLog } from "../../activity-log/model/auditLog.model";

export const getDashboardOverview = async () => {
  const [
    totalUsers,
    totalCandidates,
    totalHr,
    totalAdmins,
    activeUsers,
    totalJobs,
    openJobs,
    totalApplications,
    matchedApplications,
    totalInterviewSessions,
    completedInterviews,
    recentActivity,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: "candidate" }),
    User.countDocuments({ role: "hr" }),
    User.countDocuments({ role: "admin" }),
    User.countDocuments({ isActive: true }),
    Job.countDocuments(),
    Job.countDocuments({ status: "open" }),
    Application.countDocuments(),
    Application.countDocuments({ matched: true }),
    InterviewSession.countDocuments(),
    InterviewSession.countDocuments({ status: "completed" }),
    AuditLog.find().populate("actorId", "name email role").sort({ createdAt: -1 }).limit(10),
  ]);

  return {
    totalUsers,
    totalCandidates,
    totalHr,
    totalAdmins,
    activeUsers,
    totalJobs,
    openJobs,
    totalApplications,
    matchedApplications,
    totalInterviewSessions,
    completedInterviews,
    recentActivity,
  };
};
