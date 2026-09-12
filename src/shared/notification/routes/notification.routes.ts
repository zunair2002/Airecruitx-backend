import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.middleware";
import {
  listMyNotificationsHandler,
  markNotificationReadHandler,
} from "../controller/notification.controller";
import { validate } from "../../../middleware/validate.middleware";
import { notificationIdParamSchema } from "./notification.schema";

const router = Router();

router.get("/mine", requireAuth, listMyNotificationsHandler);
router.patch(
  "/:id/read",
  requireAuth,
  validate({ params: notificationIdParamSchema }),
  markNotificationReadHandler
);

export default router;
