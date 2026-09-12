import { Router } from "express";
import {
  generateCertificateHandler,
  getCertificateHandler,
  checkoutHandler,
  confirmPaymentHandler,
} from "../controller/certificate.controller";
import { requireAuth } from "../../../middleware/auth.middleware";
import { validate } from "../../../middleware/validate.middleware";
import { sessionIdBodySchema, sessionIdParamSchema } from "./certificate.schema";

const router = Router();

router.post("/checkout", requireAuth, validate({ body: sessionIdBodySchema }), checkoutHandler);
router.post(
  "/confirm-payment",
  requireAuth,
  validate({ body: sessionIdBodySchema }),
  confirmPaymentHandler
);
router.post("/generate", requireAuth, validate({ body: sessionIdBodySchema }), generateCertificateHandler);
router.get("/:sessionId", requireAuth, validate({ params: sessionIdParamSchema }), getCertificateHandler);

export default router;
