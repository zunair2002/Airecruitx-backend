import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { getDashboardOverview } from "../service/dashboard.service";

export const dashboardHandler = asyncHandler(async (_req: Request, res: Response) => {
  const overview = await getDashboardOverview();
  res.status(200).json({ success: true, data: overview });
});
