import crypto from "crypto";
import PDFDocument from "pdfkit";
import cloudinary from "../../../config/cloudinary";
import { Certificate, ICertificate } from "../model/certificate.model";
import { InterviewSession } from "../../interview/model/interviewSession.model";
import { User } from "../../../shared/user/model/user.model";
import { AppError } from "../../../utils/AppError";

const getPassScore = (): number => {
  const raw = process.env.CERTIFICATE_PASS_SCORE;
  const value = Number(raw);
  if (!raw || Number.isNaN(value)) {
    throw new AppError("CERTIFICATE_PASS_SCORE is not defined in the environment", 500);
  }
  return value;
};

const buildCertificatePdf = (name: string, score: number, certId: string): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ layout: "landscape", size: "A4", margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { width, height } = doc.page;

    // Border
    doc.lineWidth(3).strokeColor("#1a1a1a").rect(24, 24, width - 48, height - 48).stroke();
    doc.lineWidth(1).strokeColor("#c9a227").rect(34, 34, width - 68, height - 68).stroke();

    doc
      .fillColor("#1a1a1a")
      .font("Helvetica-Bold")
      .fontSize(30)
      .text("Certificate of Achievement", 0, 90, { align: "center" });

    doc
      .font("Helvetica")
      .fontSize(14)
      .text("This certifies that", 0, 150, { align: "center" });

    doc
      .font("Helvetica-Bold")
      .fontSize(26)
      .text(name, 0, 180, { align: "center" });

    doc
      .font("Helvetica")
      .fontSize(14)
      .text(
        `has successfully passed the Airecruitx Practice Interview with a score of ${score}%`,
        80,
        225,
        { align: "center", width: width - 160 }
      );

    doc
      .fontSize(11)
      .text(`Date: ${new Date().toDateString()}`, 0, height - 110, { align: "center" });

    doc
      .fontSize(9)
      .fillColor("#666666")
      .text(`Certificate ID: ${certId}`, 0, height - 90, { align: "center" });

    // Simple seal
    doc
      .lineWidth(2)
      .strokeColor("#c9a227")
      .circle(width - 130, height - 110, 42)
      .stroke();
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#c9a227")
      .text("AIRECRUITX", width - 172, height - 116, { width: 84, align: "center" });

    doc.end();
  });
};

const uploadCertificateToCloudinary = (buffer: Buffer, certId: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: "certificates", resource_type: "raw", public_id: `${certId}.pdf`, format: "pdf" },
      (error, result) => {
        if (error || !result) {
          reject(new AppError("Failed to upload certificate to storage", 502));
          return;
        }
        resolve(result.secure_url);
      }
    );
    uploadStream.end(buffer);
  });
};

export const generateCertificate = async (
  userId: string,
  sessionId: string
): Promise<ICertificate> => {
  // Certificates are never regenerated — return the existing one if it already exists.
  const existing = await Certificate.findOne({ sessionId, userId });
  if (existing) return existing;

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
  if (!session.certificatePayment?.paid) {
    throw new AppError("Payment is required before the certificate can be issued", 402);
  }

  // Name always comes from the authenticated user's DB record, never from the request body.
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError("User not found", 404);
  }

  const certId = `AIRX-${crypto.randomUUID().split("-")[0].toUpperCase()}`;
  const pdfBuffer = await buildCertificatePdf(user.name, session.score, certId);
  const fileUrl = await uploadCertificateToCloudinary(pdfBuffer, certId);

  return Certificate.create({
    userId,
    sessionId,
    score: session.score,
    certId,
    fileUrl,
  });
};

export const getCertificate = async (
  userId: string,
  sessionId: string
): Promise<ICertificate> => {
  const certificate = await Certificate.findOne({ sessionId, userId });
  if (!certificate) {
    throw new AppError("Certificate not found", 404);
  }
  return certificate;
};
