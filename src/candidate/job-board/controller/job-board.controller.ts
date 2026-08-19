import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import * as jobBoardService from "../service/job-board.service";

export const listOpenJobsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const jobs = await jobBoardService.listOpenJobs();
  res.status(200).json({ success: true, data: jobs });
});
