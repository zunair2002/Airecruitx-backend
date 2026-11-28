import { AppError } from "../../utils/AppError";
import nodemailer from "nodemailer";

// Lazily created so missing SMTP configuration only fails the email send, not app startup.
const transports: Partial<Record<"otp" | "general", nodemailer.Transporter>> = {};

const getTransporter = (channel: "otp" | "general" = "general"): nodemailer.Transporter => {
  const cached = transports[channel];
  if (cached) return cached;

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    throw Object.assign(new Error("Missing SMTP configuration"), { code: "ECONFIG" });
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    pool: true,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    auth: { user, pass },
  });
  transports[channel] = transporter;
  return transporter;
};

const send = async (to: string, subject: string, html: string, channel: "otp" | "general" = "general") => {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  return getTransporter(channel).sendMail({ from, to, subject, html });
};

// Waits between attempts: first try immediately, then retry after 1 s and after 5 s.
const RETRY_DELAYS_MS = [1000, 5000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends in the background so the request never waits for SMTP. Failures are retried twice and
 * then logged with the recipient, kind and error message only (never the content or OTP).
 */
const sendInBackground = (kind: string, to: string, subject: string, html: string): void => {
  void (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        await send(to, subject, html);
        return;
      } catch (error) {
        if (attempt >= RETRY_DELAYS_MS.length) throw error;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  })().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[email] Failed to send email after ${RETRY_DELAYS_MS.length + 1} attempts (to=${to}, kind=${kind}): ${message}`,
    );
  });
};

// Sent right after a password-based signup (and again on resend) — the candidate/HR
// enters this code to prove they own the email before they can log in.
type OtpFlow = "signup" | "resend" | "forgot-password";

export const sendOtpEmail = (to: string, otp: string, flow: "signup" | "resend") =>
  deliverCode(to, "Verify your email - Airecruitx", otp, flow);

export async function deliverCode(to: string, subject: string, code: string, flow: OtpFlow): Promise<void> {
  const started = Date.now();
  const context = { flow, revision: process.env.VERCEL_GIT_COMMIT_SHA || "unknown" };
  console.info("[otp] SMTP submitting", context);
  try {
    const info = await send(to, subject, `<p>Your code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`, "otp");
    const responseCode = Number(/^([0-9]{3})/.exec(info.response || "")?.[1]) || undefined;
    if (!info.accepted?.some((recipient: string) => recipient.toLowerCase() === to.toLowerCase())) {
      throw Object.assign(new Error("Recipient not accepted"), { code: "ERECIPIENT", responseCode });
    }
    console.info("[otp] SMTP accepted", { ...context, elapsedMs: Date.now() - started, responseCode, messageId: info.messageId });
  } catch (error) {
    const failure = error as { code?: string; responseCode?: number };
    console.error("[otp] SMTP failed", { ...context, elapsedMs: Date.now() - started, code: failure.code, responseCode: failure.responseCode });
    throw new AppError(flow === "signup"
      ? "Account created. Use resend verification code to try email delivery again."
      : "Email submission failed. Please request a new code.", 503);
  }
}

// Sent when HR invites a candidate to a self-paced AI interview: no fixed time, just
// a personal link valid until expiresAt — the candidate can start it whenever suits them.
export const sendOrgInterviewInvite = async (
  to: string,
  candidateName: string,
  jobTitle: string,
  joinLink: string,
  expiresAt: Date,
  calendarLink: string
): Promise<void> => {
  sendInBackground(
    "org-interview-invite",
    to,
    `You're invited to interview for ${jobTitle}`,
    `<p>Hi ${candidateName},</p>
     <p>You've been invited to complete an AI interview for <strong>${jobTitle}</strong>.</p>
     <p>Take it whenever works for you — the link below stays open until
     <strong>${expiresAt.toLocaleString()}</strong>. After that it will no longer be usable.</p>
     <p><a href="${joinLink}">Click here to start your interview</a></p>
     <p><a href="${calendarLink}">Add this window to your calendar</a></p>`
  );
};

// Sent when HR approves a matched applicant for the AI interview (single schedule or
// bulk trigger). The emailed link is the candidate's way in: it opens the interview
// session page in the app (sign-in required, as the session belongs to them).
export const sendAiInterviewInvite = async (
  to: string,
  candidateName: string,
  jobTitle: string,
  sessionLink: string,
  options: { dateTime?: Date; message?: string; calendarLink?: string } = {}
): Promise<void> => {
  const { dateTime, message, calendarLink } = options;
  sendInBackground(
    "ai-interview-invite",
    to,
    `Your AI interview for ${jobTitle} is ready`,
    `<p>Hi ${candidateName},</p>
     <p>The hiring team has approved you for an AI interview for <strong>${jobTitle}</strong>.</p>
     ${dateTime ? `<p>Suggested time: <strong>${dateTime.toLocaleString()}</strong></p>` : ""}
     ${message ? `<p>Message from the hiring team:<br/>${message}</p>` : ""}
     <p><a href="${sessionLink}">Click here to start your AI interview</a></p>
     ${calendarLink ? `<p><a href="${calendarLink}">Add it to your calendar</a></p>` : ""}
     <p>You'll be asked to sign in to your Airecruitx account first.</p>`
  );
};

// Sent when HR withdraws an organisational-interview invite that was already emailed.
export const sendOrgInterviewCancelled = async (
  to: string,
  candidateName: string,
  jobTitle: string,
  reason?: string
): Promise<void> => {
  sendInBackground(
    "org-interview-cancelled",
    to,
    `Your interview invite for ${jobTitle} was cancelled`,
    `<p>Hi ${candidateName},</p>
     <p>The hiring team has cancelled your organisational interview invite for
     <strong>${jobTitle}</strong>. The interview link you received no longer works.</p>
     ${reason ? `<p>Reason: ${reason}</p>` : ""}
     <p>If you have questions, reply to the hiring team directly.</p>`
  );
};
