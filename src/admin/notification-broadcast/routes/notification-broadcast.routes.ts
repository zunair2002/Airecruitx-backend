import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import { sendNotificationHandler } from "../controller/notification-broadcast.controller";
import { validate } from "../../../middleware/validate.middleware";
import { sendNotificationSchema } from "./notification-broadcast.schema";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.post("/", validate({ body: sendNotificationSchema }), sendNotificationHandler);

export default router;
