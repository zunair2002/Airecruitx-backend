import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { AppError } from "../utils/AppError";

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ success: false, message: err.message });
    return;
  }

  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message =
    err instanceof AppError ? err.message : "Internal server error";

  if (statusCode === 500) {
    console.error(err);
  }

  res.status(statusCode).json({
    success: false,
    message,
  });
};
