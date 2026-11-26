import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import {
  cancelSubscriptionHandler,
  confirmCheckoutHandler,
  createCheckoutHandler,
  getSubscriptionHandler,
  listPaymentsHandler,
  listPlansHandler,
  resumeSubscriptionHandler,
} from "../controller/billing.controller";

// The Stripe webhook (POST /api/billing/webhook) is mounted separately in app.ts, before
// express.json(), because it needs the raw request body.
const router = Router();

router.get("/plans", listPlansHandler);

router.use(requireAuth, requireRole("candidate"));
router.get("/subscription", getSubscriptionHandler);
router.post("/checkout", createCheckoutHandler);
router.post("/checkout/confirm", confirmCheckoutHandler);
router.post("/cancel", cancelSubscriptionHandler);
router.post("/resume", resumeSubscriptionHandler);
router.get("/payments", listPaymentsHandler);

export default router;
