import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User, UserRole } from "../shared/user/model/user.model";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";

interface JwtPayload {
  id: string;
}

export const requireAuth = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    // Browser clients authenticate via the httpOnly "token" cookie set on login/signup;
    // non-browser API clients (e.g. Postman) may instead send a Bearer token.
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : undefined;
    const token = req.cookies?.token || bearerToken;

    if (!token) {
      throw new AppError("Missing or invalid authentication credentials", 401);
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new AppError("JWT_SECRET is not defined in the environment", 500);
    }

    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, secret) as JwtPayload;
    } catch (error) {
      throw new AppError("Invalid or expired token", 401);
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      throw new AppError("User profile not found", 404);
    }
    if (!user.isActive) {
      throw new AppError("Account is deactivated", 403);
    }

    req.user = user;
    req.firebaseUid = user.firebaseUid;
    next();
  }
);

export const requireRole = (...roles: UserRole[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError("Insufficient permissions", 403);
    }
    next();
  };
};
