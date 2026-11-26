// Premium subscription settings. Prices are in the smallest currency unit (cents).
// STRIPE_PREMIUM_PRICE_ID, when set, uses a recurring Price created in the Stripe
// dashboard; otherwise checkout creates the price inline from PREMIUM_PRICE_CENTS.

export type BillingInterval = "month" | "year";

const intEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
};

export const premiumPriceCents = (): number => intEnv("PREMIUM_PRICE_CENTS", 2900);
export const premiumCurrency = (): string => (process.env.PREMIUM_CURRENCY || "usd").toLowerCase();
export const premiumInterval = (): BillingInterval =>
  process.env.PREMIUM_INTERVAL === "year" ? "year" : "month";
export const premiumTrialDays = (): number => intEnv("PREMIUM_TRIAL_DAYS", 0);
export const premiumStripePriceId = (): string | undefined => process.env.STRIPE_PREMIUM_PRICE_ID || undefined;
// A renewal that fails keeps Premium for this many days while Stripe retries the card.
export const pastDueGraceDays = (): number => intEnv("PREMIUM_PAST_DUE_GRACE_DAYS", 3);

export const stripeConfigured = (): boolean => Boolean(process.env.STRIPE_SECRET_KEY);
export const stripeWebhookSecret = (): string | undefined => process.env.STRIPE_WEBHOOK_SECRET || undefined;

// The frontend, where Stripe Checkout sends the candidate back to.
export const appBaseUrl = (): string => (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
