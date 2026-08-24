import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import { getSettingsHandler, updateSettingsHandler } from "../controller/settings.controller";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/", getSettingsHandler);
router.patch("/", updateSettingsHandler);

export default router;
