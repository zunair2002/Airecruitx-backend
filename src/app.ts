import path from "path";
import express, { Application } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

// shared (cross-role infrastructure)
import authRoutes from "./shared/user/routes/auth.routes";
import sharedNotificationRoutes from "./shared/notification/routes/notification.routes";
import sharedSupportRoutes from "./shared/support/routes/support.routes";

// candidate-owned
import resumeRoutes from "./candidate/resume/routes/resume.routes";
import interviewRoutes from "./candidate/interview/routes/interview.routes";
import certificateRoutes from "./candidate/certificate/routes/certificate.routes";
import jobBoardRoutes from "./candidate/job-board/routes/job-board.routes";
import candidateApplicationRoutes from "./candidate/applications/routes/application.routes";

// hr-owned
import jobPostingRoutes from "./hr/job-posting/routes/job-posting.routes";
import applicantReviewRoutes from "./hr/applicant-review/routes/applicant-review.routes";

// admin-owned
import adminDashboardRoutes from "./admin/dashboard/routes/dashboard.routes";
import adminUserManagementRoutes from "./admin/user-management/routes/user-management.routes";
import adminActivityLogRoutes from "./admin/activity-log/routes/activity-log.routes";
import adminContentManagementRoutes from "./admin/content-management/routes/content-management.routes";
import adminReportsRoutes from "./admin/reports/routes/reports.routes";
import adminNotificationBroadcastRoutes from "./admin/notification-broadcast/routes/notification-broadcast.routes";
import adminSettingsRoutes from "./admin/settings/routes/settings.routes";
import adminSupportDeskRoutes from "./admin/support-desk/routes/support-desk.routes";
import adminMonitoringRoutes from "./admin/monitoring/routes/monitoring.routes";

import { notFoundHandler, errorHandler } from "./middleware/error.middleware";

const app: Application = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => {
  res.status(200).json({ success: true, message: "Airecruitx API is running" });
});

// shared
app.use("/api/auth", authRoutes);
app.use("/api/notifications", sharedNotificationRoutes);
app.use("/api/support", sharedSupportRoutes);

// candidate
app.use("/api/resume", resumeRoutes);
app.use("/api/interview", interviewRoutes);
app.use("/api/certificate", certificateRoutes);
app.use("/api/jobs", jobBoardRoutes);
app.use("/api/applications", candidateApplicationRoutes);

// hr
app.use("/api/jobs", jobPostingRoutes);
app.use("/api/applications", applicantReviewRoutes);

// admin
app.use("/api/admin/dashboard", adminDashboardRoutes);
app.use("/api/admin/users", adminUserManagementRoutes);
app.use("/api/admin/activity-logs", adminActivityLogRoutes);
app.use("/api/admin/content", adminContentManagementRoutes);
app.use("/api/admin/reports", adminReportsRoutes);
app.use("/api/admin/notifications", adminNotificationBroadcastRoutes);
app.use("/api/admin/settings", adminSettingsRoutes);
app.use("/api/admin/support", adminSupportDeskRoutes);
app.use("/api/admin/monitoring", adminMonitoringRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
