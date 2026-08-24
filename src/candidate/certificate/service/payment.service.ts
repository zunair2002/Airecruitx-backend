import { InterviewSession } from "../../interview/model/interviewSession.model";
import { AppError } from "../../../utils/AppError";
import { getStripeClient } from "../../../config/stripe";

const getPassScore = (): number => {
  const raw = process.env.CERTIFICATE_PASS_SCORE;
  const value = Number(raw);
  if (!raw || Number.isNaN(value)) {
    throw new AppError("CERTIFICATE_PASS_SCORE is not defined in the environment", 500);
  }
  return value;
};

const getPriceCents = (): number => {
  const raw = process.env.CERTIFICATE_PRICE_CENTS;
  const value = Number(raw ?? 500);
  return Number.isNaN(value) ? 500 : value;
};

const getCurrency = (): string => process.env.CERTIFICATE_CURRENCY || "usd";

const getAppBaseUrl = (): string => process.env.APP_BASE_URL || "http://localhost:5000";

const assertPassedSession = async (userId: string, sessionId: string) => {
  const session = await InterviewSession.findOne({ _id: sessionId, userId });
  if (!session) {
    throw new AppError("Interview session not found", 404);
  }
  if (session.status !== "completed" || typeof session.score !== "number") {
    throw new AppError("Interview is not completed yet", 400);
  }
  const passScore = getPassScore();
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
  const baseUrl = getAppBaseUrl();

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: getCurrency(),
          product_data: { name: "Airecruitx Practice Interview Certificate" },
          unit_amount: getPriceCents(),
        },
        quantity: 1,
      },
    ],
    success_url: `${baseUrl}/?payment=success&sessionId=${sessionId}&stripeSessionId={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/?payment=cancelled&sessionId=${sessionId}`,
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
