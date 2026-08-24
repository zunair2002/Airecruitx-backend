import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { sendNotification } from "../service/notification-broadcast.service";

export const sendNotificationHandler = asyncHandler(async (req: Request, res: Response) => {
  const { userId, role, message } = req.body ?? {};
  const adminId = req.user!._id.toString();
  const recipientCount = await sendNotification(adminId, { userId, role, message });
  res.status(200).json({ success: true, data: { recipientCount } });
});
