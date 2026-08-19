import mongoose from "mongoose";
import { ErrorLog } from "../model/errorLog.model";
import { SupportTicket } from "../../../shared/support/model/supportTicket.model";

export const getMonitoringSnapshot = async () => {
  const [recentErrors, openTicketCount] = await Promise.all([
    ErrorLog.find().sort({ createdAt: -1 }).limit(20),
    SupportTicket.countDocuments({ status: "open" }),
  ]);

  return {
    dbState: mongoose.connection.readyState, // 1 = connected
    uptimeSeconds: Math.round(process.uptime()),
    recentErrors,
    openTicketCount,
  };
};
