import nodemailer from "nodemailer";

// Lazily created so a missing SMTP_USER/SMTP_PASS only breaks email-sending
// (caught and logged by callers), never blocks the rest of the app from starting.
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

// Sent right after a password-based signup (and again on resend) — the candidate/HR
// enters this code to prove they own the email before they can log in.
export const sendOtpEmail = async (to: string, name: string, otp: string): Promise<void> => {
  await send(
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
  await send(
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
  await send(
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
  await send(
    to,
    `Your interview invite for ${jobTitle} was cancelled`,
    `<p>Hi ${candidateName},</p>
     <p>The hiring team has cancelled your organisational interview invite for
     <strong>${jobTitle}</strong>. The interview link you received no longer works.</p>
     ${reason ? `<p>Reason: ${reason}</p>` : ""}
     <p>If you have questions, reply to the hiring team directly.</p>`
  );
};
