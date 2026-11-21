import Stripe from "stripe";
import { Types } from "mongoose";
import { getStripeClient } from "../../../config/stripe";
import {
  appBaseUrl,
  pastDueGraceDays,
  premiumCurrency,
  premiumInterval,
  premiumPriceCents,
  premiumStripePriceId,
  premiumTrialDays,
  stripeConfigured,
  BillingInterval,
} from "../../../config/billing";
import { IUser, User, UserPlan, effectivePlan } from "../../user/model/user.model";
import { Notification } from "../../notification/model/notification.model";
import { emitToUser } from "../../../config/socket";
import { AppError } from "../../../utils/AppError";
import { Payment, IPayment } from "../model/payment.model";
import { PRACTICE_LIMITS } from "../../../candidate/interview/service/practiceUsage.service";

// ---------------------------------------------------------------- plans
export interface BillingPlan {
  id: UserPlan;
  name: string;
  priceCents: number;
  currency: string;
  interval: BillingInterval;
  trialDays: number;
  practiceInterviewsPerDay: number;
  premiumCourses: boolean;
}

export const listPlans = (): { plans: BillingPlan[]; checkoutAvailable: boolean } => ({
  plans: [
    {
      id: "free",
      name: "Free",
      priceCents: 0,
      currency: premiumCurrency(),
      interval: premiumInterval(),
      trialDays: 0,
      practiceInterviewsPerDay: PRACTICE_LIMITS.free,
      premiumCourses: false,
    },
    {
      id: "premium",
      name: "Premium",
      priceCents: premiumPriceCents(),
      currency: premiumCurrency(),
      interval: premiumInterval(),
      trialDays: premiumTrialDays(),
      practiceInterviewsPerDay: PRACTICE_LIMITS.premium,
      premiumCourses: true,
    },
  ],
  checkoutAvailable: stripeConfigured(),
});

// ---------------------------------------------------------------- status
// Stripe statuses that keep (or grant) Premium. past_due keeps it only for a short grace period.
const LIVE_STATUSES = ["active", "trialing", "past_due"];
const PREMIUM_STATUSES = ["active", "trialing"];
// Small buffer after the paid period so a renewal webhook arriving a little late doesn't
// drop the candidate to free for a moment.
const RENEWAL_BUFFER_MS = 60 * 60 * 1000;

export interface SubscriptionStatus {
  plan: UserPlan;
  source: "stripe" | "admin" | null;
  status: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  planExpiresAt: Date | null;
  canUpgrade: boolean;
  canCancel: boolean;
  canResume: boolean;
}

const hasLiveStripeSubscription = (user: IUser): boolean =>
  Boolean(user.subscription?.stripeSubscriptionId && LIVE_STATUSES.includes(user.subscription.status ?? ""));

export const toSubscriptionStatus = (user: IUser): SubscriptionStatus => {
  const plan = effectivePlan(user);
  const live = hasLiveStripeSubscription(user);
  const cancelAtPeriodEnd = Boolean(user.subscription?.cancelAtPeriodEnd);
  const source = plan === "premium"
    ? user.planSource ?? (live ? "stripe" : null)
    : live ? "stripe" : null;
  return {
    plan,
    source,
    status: user.subscription?.status ?? null,
    currentPeriodEnd: user.subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd,
    planExpiresAt: plan === "premium" ? user.planExpiresAt ?? null : null,
    canUpgrade: plan === "free" && !live,
    canCancel: live && !cancelAtPeriodEnd,
    canResume: live && cancelAtPeriodEnd,
  };
};

const findUserOr404 = async (userId: string): Promise<IUser> => {
  const user = await User.findById(userId);
  if (!user) throw new AppError("User not found", 404);
  return user;
};

export const getSubscriptionStatus = async (userId: string): Promise<SubscriptionStatus> =>
  toSubscriptionStatus(await findUserOr404(userId));

// ---------------------------------------------------------------- helpers
const stripeOr503 = (): Stripe => {
  if (!stripeConfigured()) {
    throw new AppError("Payments are not available right now. Please try again later.", 503);
  }
  return getStripeClient();
};

/** Runs a Stripe API call; Stripe-side failures become a clear 502 instead of a bare 500. */
const callStripe = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    console.error(`[billing] Stripe ${label} failed:`, error?.message ?? error);
    throw new AppError("The payment provider could not complete this request. Please try again.", 502);
  }
};

const idOf = (value: string | { id: string } | null | undefined): string | undefined =>
  typeof value === "string" ? value : value?.id;

const toDate = (seconds: number | null | undefined): Date | undefined =>
  typeof seconds === "number" ? new Date(seconds * 1000) : undefined;

const notify = async (userId: string, message: string): Promise<void> => {
  try {
    const notification = await Notification.create({ userId, message });
    emitToUser(userId, "admin:notification", { notificationId: notification._id, message });
  } catch (error) {
    console.error(`[billing] Failed to notify user ${userId}:`, error);
  }
};

const formatDate = (date: Date): string =>
  date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

// ---------------------------------------------------------------- subscription sync
const findUserForSubscription = async (subscription: Stripe.Subscription): Promise<IUser | null> => {
  const metaUserId = subscription.metadata?.userId;
  if (metaUserId && Types.ObjectId.isValid(metaUserId)) {
    const user = await User.findById(metaUserId);
    if (user) return user;
  }
  return (
    (await User.findOne({ "subscription.stripeSubscriptionId": subscription.id })) ??
    (await User.findOne({ "subscription.stripeCustomerId": idOf(subscription.customer) }))
  );
};

/**
 * Copies a Stripe subscription onto the user and sets the plan from it. Idempotent, so the
 * webhook, the post-checkout confirm and the expiry sweep can all call it.
 */
export const applySubscription = async (subscription: Stripe.Subscription): Promise<IUser | null> => {
  const user = await findUserForSubscription(subscription);
  if (!user) {
    console.warn(`[billing] No user for Stripe subscription ${subscription.id}`);
    return null;
  }

  // An old, ended subscription must not overwrite a newer live one.
  const currentId = user.subscription?.stripeSubscriptionId;
  if (currentId && currentId !== subscription.id && hasLiveStripeSubscription(user)
      && !LIVE_STATUSES.includes(subscription.status)) {
    return user;
  }

  const item = subscription.items?.data?.[0];
  const periodStart = toDate(item?.current_period_start);
  const periodEnd = toDate(item?.current_period_end);
  const before = effectivePlan(user);

  user.subscription = {
    stripeCustomerId: idOf(subscription.customer) ?? user.subscription?.stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    status: subscription.status,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    updatedAt: new Date(),
  };

  if (PREMIUM_STATUSES.includes(subscription.status)) {
    user.plan = "premium";
    user.planSource = "stripe";
    user.planExpiresAt = periodEnd ? new Date(periodEnd.getTime() + RENEWAL_BUFFER_MS) : undefined;
  } else if (subscription.status === "past_due") {
    // The renewal failed and Stripe is retrying: keep Premium for a short grace period only.
    const graceEnd = new Date((periodStart ?? new Date()).getTime() + pastDueGraceDays() * 86_400_000);
    user.plan = "premium";
    user.planSource = "stripe";
    user.planExpiresAt = periodEnd && periodEnd < graceEnd ? periodEnd : graceEnd;
  } else if (user.planSource !== "admin") {
    // canceled, unpaid, incomplete, incomplete_expired, paused: no Premium from Stripe.
    user.plan = "free";
    user.planSource = undefined;
    user.planExpiresAt = undefined;
  }
  await user.save();

  const after = effectivePlan(user);
  const userId = user._id.toString();
  if (before === "free" && after === "premium") {
    await notify(userId, "Premium is active. Enjoy every course and 10 practice interviews a day.");
  } else if (before === "premium" && after === "free") {
    await notify(userId, "Your Premium plan has ended. You're now on the Free plan.");
  }
  return user;
};

// ---------------------------------------------------------------- payment history
const recordInvoice = async (invoice: Stripe.Invoice, status: "paid" | "failed"): Promise<void> => {
  if (!invoice.id) return;
  const customerId = idOf(invoice.customer as string | { id: string } | null);
  const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription ?? null);
  const metaUserId = invoice.parent?.subscription_details?.metadata?.userId;
  const user =
    (metaUserId && Types.ObjectId.isValid(metaUserId) ? await User.findById(metaUserId) : null) ??
    (customerId ? await User.findOne({ "subscription.stripeCustomerId": customerId }) : null);
  if (!user) {
    console.warn(`[billing] No user for Stripe invoice ${invoice.id}`);
    return;
  }
  const line = invoice.lines?.data?.[0];
  await Payment.updateOne(
    { stripeInvoiceId: invoice.id },
    {
      $set: {
        userId: user._id,
        kind: "subscription",
        status,
        amountCents: status === "paid" ? invoice.amount_paid : invoice.amount_due,
        currency: invoice.currency,
        description: line?.description || "Airecruitx Premium",
        stripeSubscriptionId: subscriptionId,
        invoiceNumber: invoice.number ?? undefined,
        periodStart: toDate(line?.period?.start),
        periodEnd: toDate(line?.period?.end),
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
        invoicePdfUrl: invoice.invoice_pdf ?? undefined,
      },
    },
    { upsert: true }
  );
  if (status === "failed") {
    await notify(
      user._id.toString(),
      "We couldn't charge your card for Premium. Please update your payment method to keep Premium."
    );
  }
};

/** Certificate purchases (one-off Checkout payments) also appear in the payment history. */
export const recordCertificatePayment = async (
  userId: string,
  checkoutSession: Stripe.Checkout.Session
): Promise<void> => {
  await Payment.updateOne(
    { stripeCheckoutSessionId: checkoutSession.id },
    {
      $set: {
        userId,
        kind: "certificate",
        status: "paid",
        amountCents: checkoutSession.amount_total ?? 0,
        currency: checkoutSession.currency ?? "usd",
        description: "Practice interview certificate",
      },
    },
    { upsert: true }
  );
};

export const listPayments = async (userId: string): Promise<IPayment[]> =>
  Payment.find({ userId }).sort({ createdAt: -1 }).limit(100);

// ---------------------------------------------------------------- checkout
const ensureCustomer = async (stripe: Stripe, user: IUser): Promise<string> => {
  const existing = user.subscription?.stripeCustomerId;
  if (existing) return existing;
  const customer = await callStripe("customer create", () =>
    stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { userId: user._id.toString() },
    })
  );
  user.set("subscription.stripeCustomerId", customer.id);
  await user.save();
  return customer.id;
};

/** Starts Stripe Checkout for the Premium subscription; the browser is sent to checkoutUrl. */
export const createPremiumCheckout = async (userId: string): Promise<{ checkoutUrl: string }> => {
  const user = await findUserOr404(userId);
  if (effectivePlan(user) === "premium" || hasLiveStripeSubscription(user)) {
    throw new AppError("You're already on Premium", 409);
  }
  const stripe = stripeOr503();
  const customer = await ensureCustomer(stripe, user);
  const priceId = premiumStripePriceId();
  const trialDays = premiumTrialDays();
  const base = appBaseUrl();

  const session = await callStripe("checkout create", () => stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: userId,
    line_items: [
      priceId
        ? { price: priceId, quantity: 1 }
        : {
            price_data: {
              currency: premiumCurrency(),
              unit_amount: premiumPriceCents(),
              recurring: { interval: premiumInterval() },
              product_data: { name: "Airecruitx Premium" },
            },
            quantity: 1,
          },
    ],
    subscription_data: {
      metadata: { userId },
      ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
    },
    metadata: { userId, kind: "premium" },
    success_url: `${base}/candidate/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/candidate/billing?checkout=cancelled`,
  }));
  if (!session.url) throw new AppError("Failed to start checkout", 502);
  return { checkoutUrl: session.url };
};

/**
 * Called when Stripe sends the candidate back: reads the Checkout session and applies the
 * subscription right away, so Premium works even before (or without) the webhook.
 */
export const confirmPremiumCheckout = async (userId: string, sessionId: string): Promise<SubscriptionStatus> => {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new AppError("Invalid checkout session id", 400);
  const stripe = stripeOr503();
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription.latest_invoice"] });
  } catch {
    throw new AppError("Checkout session not found", 404);
  }
  if (session.client_reference_id !== userId || session.mode !== "subscription") {
    throw new AppError("Checkout session not found", 404);
  }
  const subscription = session.subscription;
  if (session.status === "complete" && subscription && typeof subscription !== "string") {
    await applySubscription(subscription);
    const invoice = subscription.latest_invoice;
    if (invoice && typeof invoice !== "string" && invoice.status === "paid") {
      await recordInvoice(invoice, "paid");
    }
  }
  return getSubscriptionStatus(userId);
};

// ---------------------------------------------------------------- cancel / resume
const liveSubscriptionIdOr409 = (user: IUser): string => {
  if (!hasLiveStripeSubscription(user)) {
    throw new AppError("You don't have an active Premium subscription", 409);
  }
  return user.subscription!.stripeSubscriptionId!;
};

/** Cancels at the end of the paid period: Premium stays until then and doesn't renew. */
export const cancelSubscription = async (userId: string): Promise<SubscriptionStatus> => {
  const user = await findUserOr404(userId);
  const subscriptionId = liveSubscriptionIdOr409(user);
  if (user.subscription?.cancelAtPeriodEnd) return toSubscriptionStatus(user);
  const stripe = stripeOr503();
  const updated = await callStripe("cancel", () =>
    stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true })
  );
  const saved = await applySubscription(updated);
  return toSubscriptionStatus(saved ?? user);
};

/** Undoes a pending cancel, so the subscription renews as normal. */
export const resumeSubscription = async (userId: string): Promise<SubscriptionStatus> => {
  const user = await findUserOr404(userId);
  const subscriptionId = liveSubscriptionIdOr409(user);
  if (!user.subscription?.cancelAtPeriodEnd) return toSubscriptionStatus(user);
  const stripe = stripeOr503();
  const updated = await callStripe("resume", () =>
    stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false })
  );
  const saved = await applySubscription(updated);
  return toSubscriptionStatus(saved ?? user);
};

// ---------------------------------------------------------------- webhook
/** Handles one verified Stripe event. Throws on failure so Stripe retries it. */
export const handleStripeEvent = async (event: Stripe.Event): Promise<void> => {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription" || !session.subscription) return;
      const subscription = await getStripeClient().subscriptions.retrieve(idOf(session.subscription)!);
      await applySubscription(subscription);
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(event.data.object);
      return;
    case "invoice.paid": {
      const invoice = event.data.object;
      await recordInvoice(invoice, "paid");
      const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription ?? null);
      if (subscriptionId) await applySubscription(await getStripeClient().subscriptions.retrieve(subscriptionId));
      return;
    }
    case "invoice.payment_failed":
      await recordInvoice(event.data.object, "failed");
      return;
    default:
      return;
  }
};

// ---------------------------------------------------------------- expiry
/**
 * Hourly sweep (config/planExpiryScheduler.ts): premium plans whose end date has passed go
 * back to free. A Stripe plan is re-read from Stripe first, in case a renewal webhook was missed.
 */
export const expireLapsedPlans = async (): Promise<number> => {
  const lapsed = await User.find({ plan: "premium", planExpiresAt: { $lte: new Date() } }).limit(200);
  let expired = 0;
  for (const user of lapsed) {
    try {
      const subscriptionId = user.subscription?.stripeSubscriptionId;
      if (user.planSource === "stripe" && subscriptionId && stripeConfigured()) {
        const refreshed = await applySubscription(await getStripeClient().subscriptions.retrieve(subscriptionId));
        if (refreshed && effectivePlan(refreshed) === "premium") continue;
        if (refreshed?.plan === "free") { expired++; continue; }
      }
      user.plan = "free";
      user.planSource = undefined;
      user.planExpiresAt = undefined;
      await user.save();
      expired++;
      await notify(user._id.toString(), "Your Premium plan has ended. You're now on the Free plan.");
    } catch (error) {
      console.error(`[billing] Failed to expire plan for user ${user._id}:`, error);
    }
  }
  return expired;
};

// ---------------------------------------------------------------- admin
/** Admin grant/removal of Premium for a candidate, optionally until a date. */
export const setPlanByAdmin = async (
  userId: string,
  plan: UserPlan,
  expiresAt: Date | null
): Promise<{ user: IUser; from: UserPlan }> => {
  const user = await findUserOr404(userId);
  if (user.role !== "candidate") throw new AppError("Plans apply to candidate accounts only", 400);
  if (hasLiveStripeSubscription(user)) {
    throw new AppError(
      "This candidate pays for Premium through Stripe. Their subscription must be cancelled before the plan can be changed here.",
      409
    );
  }
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new AppError("expiresAt must be in the future", 400);
  }
  const from = effectivePlan(user);
  if (plan === "premium") {
    user.plan = "premium";
    user.planSource = "admin";
    user.planExpiresAt = expiresAt ?? undefined;
  } else {
    user.plan = "free";
    user.planSource = undefined;
    user.planExpiresAt = undefined;
  }
  await user.save();

  const id = user._id.toString();
  if (plan === "premium") {
    await notify(id, expiresAt ? `You've been given Premium until ${formatDate(expiresAt)}.` : "You've been given Premium.");
  } else if (from === "premium") {
    await notify(id, "Your plan was changed to Free.");
  }
  return { user, from };
};
