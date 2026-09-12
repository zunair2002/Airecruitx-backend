import { InterviewSession } from "../../interview/model/interviewSession.model";
import { AppError } from "../../../utils/AppError";
import { getStripeClient } from "../../../config/stripe";
import { getEnv } from "../../../config/env";

const assertPassedSession = async (userId: string, sessionId: string) => {
  const session = await InterviewSession.findOne({ _id: sessionId, userId });
  if (!session) {
    throw new AppError("Interview session not found", 404);
  }
  if (session.status !== "completed" || typeof session.score !== "number") {
    throw new AppError("Interview is not completed yet", 400);
  }
  const passScore = getEnv().certificatePassScore;
  if (session.score <= passScore) {
    throw new AppError(`Score must be above ${passScore} to earn a certificate`, 403);
  }
  return session;
};

export const createCertificateCheckout = async (
  userId: string,
  sessionId: string
): Promise<{ checkoutUrl: string }> => {
  const session = await assertPassedSession(userId, sessionId);

  if (session.certificatePayment?.paid) {
    throw new AppError("Certificate is already paid for", 409);
  }

  const stripe = getStripeClient();
  const { appBaseUrl, certificateCurrency, certificatePriceCents } = getEnv();

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: certificateCurrency,
          product_data: { name: "Airecruitx Practice Interview Certificate" },
          unit_amount: certificatePriceCents,
        },
        quantity: 1,
      },
    ],
    success_url: `${appBaseUrl}/?payment=success&sessionId=${sessionId}&stripeSessionId={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appBaseUrl}/?payment=cancelled&sessionId=${sessionId}`,
  });

  if (!checkoutSession.url) {
    throw new AppError("Failed to create checkout session", 502);
  }

  session.certificatePayment = { paid: false, stripeSessionId: checkoutSession.id };
  await session.save();

  return { checkoutUrl: checkoutSession.url };
};

export const confirmCertificatePayment = async (
  userId: string,
  sessionId: string
): Promise<{ paid: boolean }> => {
  const session = await InterviewSession.findOne({ _id: sessionId, userId });
  if (!session) {
    throw new AppError("Interview session not found", 404);
  }
  if (session.certificatePayment?.paid) {
    return { paid: true };
  }
  if (!session.certificatePayment?.stripeSessionId) {
    throw new AppError("No checkout session found for this interview", 400);
  }

  const stripe = getStripeClient();
  const checkoutSession = await stripe.checkout.sessions.retrieve(
    session.certificatePayment.stripeSessionId
  );

  if (checkoutSession.payment_status !== "paid") {
    return { paid: false };
  }

  session.certificatePayment.paid = true;
  await session.save();

  return { paid: true };
};
