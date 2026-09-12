import Stripe from "stripe";
import { getEnv } from "./env";

let stripeClient: Stripe | undefined;

export const getStripeClient = (): Stripe => {
  if (stripeClient) return stripeClient;
  stripeClient = new Stripe(getEnv().stripeSecretKey);
  return stripeClient;
};
