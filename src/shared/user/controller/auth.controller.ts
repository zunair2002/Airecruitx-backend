import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { AppError } from "../../../utils/AppError";
import * as authService from "../service/auth.service";
import { IUser, UserRole } from "../model/user.model";

const VALID_ROLES: UserRole[] = ["candidate", "hr", "admin"];

// httpOnly so client-side JS (and thus XSS) can never read or exfiltrate the token;
// the browser sends it automatically on every same-site request.
const COOKIE_NAME = "token";
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // matches the JWT's 1d expiry

const setAuthCookie = (res: Response, token: string) => {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_MS,
  });
};

// Shared, safe shape for returning a user to the client (never includes the password).
const toPublicUser = (user: IUser) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  authProvider: user.authProvider,
  avatarUrl: user.avatarUrl,
});

export const signupHandler = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password, role } = req.body ?? {};

  if (!name || typeof name !== "string") {
    throw new AppError("name is required", 400);
  }
  if (!email || typeof email !== "string") {
    throw new AppError("email is required", 400);
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    throw new AppError("password must be at least 6 characters", 400);
  }
  if (!role || !VALID_ROLES.includes(role)) {
    throw new AppError(`role must be one of: ${VALID_ROLES.join(", ")}`, 400);
  }

  const { token, user } = await authService.signup({ name, email, password, role });

  setAuthCookie(res, token);
  res.status(201).json({
    success: true,
    data: {
      token,
      user: toPublicUser(user),
    },
  });
});

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};

  if (!email || typeof email !== "string") {
    throw new AppError("email is required", 400);
  }
  if (!password || typeof password !== "string") {
    throw new AppError("password is required", 400);
  }

  const { token, user } = await authService.login({ email, password });

  setAuthCookie(res, token);
  res.status(200).json({
    success: true,
    data: {
      token,
      user: toPublicUser(user),
    },
  });
});

export const googleLoginHandler = asyncHandler(async (req: Request, res: Response) => {
  const { idToken, role } = req.body ?? {};

  if (!idToken || typeof idToken !== "string") {
    throw new AppError("idToken is required", 400);
  }
  if (role && !VALID_ROLES.includes(role)) {
    throw new AppError(`role must be one of: ${VALID_ROLES.join(", ")}`, 400);
  }

  const { token, user } = await authService.googleLogin(idToken, role);

  setAuthCookie(res, token);
  res.status(200).json({
    success: true,
    data: {
      token,
      user: toPublicUser(user),
    },
  });
});

export const meHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;

  res.status(200).json({
    success: true,
    data: {
      ...toPublicUser(user),
      orgId: user.orgId,
    },
  });
});

export const logoutHandler = asyncHandler(async (req: Request, res: Response) => {
  // firebaseUid is only present for Google-signed-in users; logout is a no-op otherwise
  // since our own JWT sessions are stateless and simply get discarded client-side.
  await authService.logout(req.firebaseUid);

  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});
