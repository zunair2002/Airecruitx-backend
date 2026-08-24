import { Notification, INotification } from "../model/notification.model";
import { AppError } from "../../../utils/AppError";

export const listMyNotifications = async (userId: string): Promise<INotification[]> => {
  return Notification.find({ userId }).sort({ createdAt: -1 });
};

export const markRead = async (userId: string, notificationId: string): Promise<INotification> => {
  const notification = await Notification.findOne({ _id: notificationId, userId });
  if (!notification) {
    throw new AppError("Notification not found", 404);
  }
  notification.read = true;
  await notification.save();
  return notification;
};
