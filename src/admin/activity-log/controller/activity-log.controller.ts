import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { listActivityLogs } from "../service/activity-log.service";

export const listActivityLogsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { actorId, action } = req.query;
  const logs = await listActivityLogs({
    actorId: typeof actorId === "string" ? actorId : undefined,
    action: typeof action === "string" ? action : undefined,
  });
  res.status(200).json({ success: true, data: logs });
});
