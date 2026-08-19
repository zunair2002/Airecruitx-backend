import Stripe from "stripe";

let stripeClient: Stripe | undefined;

// Lazy-init so the app can boot without a Stripe key set — the error only surfaces
// when a payment endpoint is actually hit, same pattern as JWT_SECRET/CERTIFICATE_PASS_SCORE.
export const getStripeClient = (): Stripe => {
  if (stripeClient) return stripeClient;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not defined in the environment");
  }

  stripeClient = new Stripe(secretKey);
  return stripeClient;
};
