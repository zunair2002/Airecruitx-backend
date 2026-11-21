import nodemailer from "nodemailer";

// Lazily created so missing SMTP configuration only fails the email send, not app startup.
let transporter: nodemailer.Transporter | null = null;

const getTransporter = (): nodemailer.Transporter => {
  if (transporter) return transporter;

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    throw new Error("SMTP_USER/SMTP_PASS are not configured — cannot send email");
  }

  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
  return transporter;
};

const send = async (to: string, subject: string, html: string): Promise<void> => {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await getTransporter().sendMail({ from, to, subject, html });
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
export const sendOtpEmail = async (to: string, name: string, otp: string): Promise<void> => {
  sendInBackground(
    "otp",
    to,
    "Verify your email — Airecruitx",
    `<p>Hi ${name},</p>
     <p>Your verification code is:</p>
     <p style="font-size:28px; font-weight:bold; letter-spacing:4px;">${otp}</p>
     <p>This code expires in 10 minutes. If you didn't create an Airecruitx account, you can ignore this email.</p>`
  );
};

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
