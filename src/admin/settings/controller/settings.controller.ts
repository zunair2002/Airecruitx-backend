import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import * as settingsService from "../service/settings.service";

export const getSettingsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await settingsService.getSettings();
  res.status(200).json({ success: true, data: settings });
});

export const updateSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const adminId = req.user!._id.toString();
  const settings = await settingsService.updateSettings(adminId, req.body ?? {});
  res.status(200).json({ success: true, data: settings });
});
