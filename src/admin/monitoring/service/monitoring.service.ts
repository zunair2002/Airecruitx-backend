import mongoose from "mongoose";
import { SupportTicket } from "../../../shared/support/model/supportTicket.model";

// Errors are no longer persisted to the database (see error.middleware.ts) — every
// 5xx response was writing a document, which added up fast under any real error rate
// (e.g. Ollama being briefly unreachable) for no real operational benefit; server logs
// (console.error) already capture the same information for debugging.
export const getMonitoringSnapshot = async () => {
  const openTicketCount = await SupportTicket.countDocuments({ status: "open" });

  return {
    dbState: mongoose.connection.readyState, // 1 = connected
    uptimeSeconds: Math.round(process.uptime()),
    openTicketCount,
  };
};
