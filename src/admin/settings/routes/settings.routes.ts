import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import { getSettingsHandler, updateSettingsHandler } from "../controller/settings.controller";
import { validate } from "../../../middleware/validate.middleware";
import { updateSettingsSchema } from "./settings.schema";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/", getSettingsHandler);
router.patch("/", validate({ body: updateSettingsSchema }), updateSettingsHandler);

export default router;
