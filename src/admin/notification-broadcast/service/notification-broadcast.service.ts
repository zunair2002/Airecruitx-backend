import { User } from "../../../shared/user/model/user.model";
import { Notification } from "../../../shared/notification/model/notification.model";
import { AppError } from "../../../utils/AppError";
import { emitToUser } from "../../../config/socket";
import { logActivity } from "../../activity-log/service/activity-log.service";

interface SendNotificationInput {
  userId?: string;
  role?: string;
  message: string;
}

export const sendNotification = async (
  adminId: string,
  input: SendNotificationInput
): Promise<number> => {
  if (!input.message?.trim()) {
    throw new AppError("message is required", 400);
  }
  if (!input.userId && !input.role) {
    throw new AppError("Either userId or role is required", 400);
  }

  const recipients = input.userId
    ? [input.userId]
    : (await User.find({ role: input.role }).select("_id")).map((u) => u._id.toString());

  for (const recipientId of recipients) {
    const notification = await Notification.create({ userId: recipientId, message: input.message });
    emitToUser(recipientId, "admin:notification", {
      notificationId: notification._id,
      message: notification.message,
    });
  }

  await logActivity(adminId, "admin", "notification.send", "User", input.userId, {
    role: input.role,
    message: input.message,
    recipientCount: recipients.length,
  });

  return recipients.length;
};
