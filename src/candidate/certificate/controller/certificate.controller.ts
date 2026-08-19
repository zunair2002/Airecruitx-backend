import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { AppError } from "../../../utils/AppError";
import * as certificateService from "../service/certificate.service";
import * as paymentService from "../service/payment.service";

export const generateCertificateHandler = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.body ?? {};
  if (!sessionId || typeof sessionId !== "string") {
    throw new AppError("sessionId is required", 400);
  }

  const userId = req.user!._id.toString();
  const certificate = await certificateService.generateCertificate(userId, sessionId);

  res.status(200).json({
    success: true,
    data: { certificateUrl: certificate.fileUrl, certId: certificate.certId, score: certificate.score },
  });
});

export const checkoutHandler = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.body ?? {};
  if (!sessionId || typeof sessionId !== "string") {
    throw new AppError("sessionId is required", 400);
  }

  const userId = req.user!._id.toString();
  const { checkoutUrl } = await paymentService.createCertificateCheckout(userId, sessionId);

  res.status(200).json({ success: true, data: { checkoutUrl } });
});

export const confirmPaymentHandler = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.body ?? {};
  if (!sessionId || typeof sessionId !== "string") {
    throw new AppError("sessionId is required", 400);
  }

  const userId = req.user!._id.toString();
  const result = await paymentService.confirmCertificatePayment(userId, sessionId);

  res.status(200).json({ success: true, data: result });
});

export const getCertificateHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const certificate = await certificateService.getCertificate(userId, req.params.sessionId);

  res.status(200).json({
    success: true,
    data: { certificateUrl: certificate.fileUrl, certId: certificate.certId, score: certificate.score },
  });
});
