import { Router } from "express";
import {
  generateCertificateHandler,
  getCertificateHandler,
  checkoutHandler,
  confirmPaymentHandler,
} from "../controller/certificate.controller";
import { requireAuth } from "../../../middleware/auth.middleware";

const router = Router();

router.post("/checkout", requireAuth, checkoutHandler);
router.post("/confirm-payment", requireAuth, confirmPaymentHandler);
router.post("/generate", requireAuth, generateCertificateHandler);
router.get("/:sessionId", requireAuth, getCertificateHandler);

export default router;
