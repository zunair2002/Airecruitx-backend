import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import * as authService from "../service/auth.service";
import { IUser } from "../model/user.model";
import { getEnv } from "../../../config/env";

// httpOnly so client-side JS (and thus XSS) can never read or exfiltrate the token;
// the browser sends it automatically on every same-site request.
const COOKIE_NAME = "token";
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // matches the JWT's 1d expiry

const setAuthCookie = (res: Response, token: string) => {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: getEnv().nodeEnv === "production",
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
  const { name, email, password, role } = req.body;

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
  const { email, password } = req.body;

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
  const { idToken, role } = req.body;

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

// No auth check needed here — clearing a cookie can't fail based on who's asking,
// so this skips the DB lookup requireAuth would otherwise do on every logout.
export const logoutHandler = (req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: getEnv().nodeEnv === "production",
    sameSite: "lax",
  });

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
};
