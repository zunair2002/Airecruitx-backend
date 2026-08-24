import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import { sendNotificationHandler } from "../controller/notification-broadcast.controller";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.post("/", sendNotificationHandler);

export default router;
