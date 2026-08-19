import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import * as notificationService from "../service/notification.service";

export const listMyNotificationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const notifications = await notificationService.listMyNotifications(userId);
  res.status(200).json({ success: true, data: notifications });
});

export const markNotificationReadHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const notification = await notificationService.markRead(userId, req.params.id);
  res.status(200).json({ success: true, data: notification });
});
