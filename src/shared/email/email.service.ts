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

export const sendOrgInterviewConfirmation = async (
  to: string,
  candidateName: string,
  jobTitle: string,
  dateTime: Date
): Promise<void> => {
  await send(
    to,
    `Your interview for ${jobTitle} is scheduled`,
    `<p>Hi ${candidateName},</p>
     <p>Your AI interview for <strong>${jobTitle}</strong> has been scheduled for
     <strong>${dateTime.toLocaleString()}</strong>.</p>
     <p>You'll get a reminder email with a join link shortly before it starts.</p>`
  );
};

export const sendOrgInterviewReminder = async (
  to: string,
  candidateName: string,
  jobTitle: string,
  dateTime: Date,
  joinLink: string
): Promise<void> => {
  await send(
    to,
    `Starting soon: your interview for ${jobTitle}`,
    `<p>Hi ${candidateName},</p>
     <p>Your AI interview for <strong>${jobTitle}</strong> starts at
     <strong>${dateTime.toLocaleString()}</strong> — almost time to begin.</p>
     <p><a href="${joinLink}">Click here to join your interview</a></p>`
  );
};
