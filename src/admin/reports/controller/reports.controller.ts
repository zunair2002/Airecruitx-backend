import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { getReportsSummary } from "../service/reports.service";

export const reportsSummaryHandler = asyncHandler(async (_req: Request, res: Response) => {
  const summary = await getReportsSummary();
  res.status(200).json({ success: true, data: summary });
});
