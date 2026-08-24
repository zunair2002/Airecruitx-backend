import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { getMonitoringSnapshot } from "../service/monitoring.service";

export const monitoringHandler = asyncHandler(async (_req: Request, res: Response) => {
  const snapshot = await getMonitoringSnapshot();
  res.status(200).json({ success: true, data: snapshot });
});
