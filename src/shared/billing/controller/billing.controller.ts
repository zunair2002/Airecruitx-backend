import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { AppError } from "../../../utils/AppError";
import { getStripeClient } from "../../../config/stripe";
import { stripeWebhookSecret } from "../../../config/billing";
import * as billingService from "../service/billing.service";

const userIdOf = (req: Request): string => req.user!._id.toString();

export const listPlansHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.status(200).json({ success: true, data: billingService.listPlans() });
});

export const getSubscriptionHandler = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, data: await billingService.getSubscriptionStatus(userIdOf(req)) });
});

export const createCheckoutHandler = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, data: await billingService.createPremiumCheckout(userIdOf(req)) });
});

export const confirmCheckoutHandler = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.body ?? {};
  if (typeof sessionId !== "string" || !sessionId) {
    throw new AppError("sessionId is required", 400);
  }
  const data = await billingService.confirmPremiumCheckout(userIdOf(req), sessionId);
  res.status(200).json({ success: true, data });
});

export const cancelSubscriptionHandler = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, data: await billingService.cancelSubscription(userIdOf(req)) });
});

export const resumeSubscriptionHandler = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, data: await billingService.resumeSubscription(userIdOf(req)) });
});

export const listPaymentsHandler = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, data: await billingService.listPayments(userIdOf(req)) });
});

/**
 * POST /api/billing/webhook — Stripe only. Mounted with express.raw() before express.json()
 * (see app.ts) because the signature is checked against the exact request bytes.
 */
export const stripeWebhookHandler = async (req: Request, res: Response): Promise<void> => {
  const secret = stripeWebhookSecret();
  if (!secret) {
    res.status(503).json({ success: false, message: "Stripe webhook is not configured" });
    return;
  }
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string" || !Buffer.isBuffer(req.body)) {
    res.status(400).json({ success: false, message: "Missing Stripe signature" });
    return;
  }

  let event;
  try {
    event = getStripeClient().webhooks.constructEvent(req.body, signature, secret);
  } catch (error: any) {
    console.warn("[billing] Rejected Stripe webhook:", error?.message ?? error);
    res.status(400).json({ success: false, message: "Invalid Stripe signature" });
    return;
  }

  try {
    await billingService.handleStripeEvent(event);
    res.status(200).json({ received: true });
  } catch (error: any) {
    // A 500 makes Stripe retry the event later.
    console.error(`[billing] Failed to handle Stripe event ${event.id} (${event.type}):`, error?.message ?? error);
    res.status(500).json({ success: false, message: "Webhook handling failed" });
  }
};
