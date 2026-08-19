import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.middleware";
import {
  listMyNotificationsHandler,
  markNotificationReadHandler,
} from "../controller/notification.controller";

const router = Router();

router.get("/mine", requireAuth, listMyNotificationsHandler);
router.patch("/:id/read", requireAuth, markNotificationReadHandler);

export default router;
