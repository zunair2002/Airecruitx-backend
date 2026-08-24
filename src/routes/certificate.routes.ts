import { Router } from "express";
import {
  generateCertificateHandler,
  getCertificateHandler,
} from "../controllers/certificate.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.post("/generate", requireAuth, generateCertificateHandler);
router.get("/:sessionId", requireAuth, getCertificateHandler);

export default router;
