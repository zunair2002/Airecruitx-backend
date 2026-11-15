import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { AppError } from "../../../utils/AppError";
import * as authService from "../service/auth.service";
import * as candidateProfileService from "../service/candidate-profile.service";
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
  headline: user.headline ?? "",
  about: user.about ?? "",
  interests: user.interests ?? [],
  emailVerified: user.emailVerified,
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

  const { user, otp } = await authService.signup({ name, email, password, role });

  // No cookie/token here — a password signup must verify the OTP just emailed to
  // them before they get a session (see verifyEmailHandler, where the token is
  // actually issued).
  res.status(201).json({
    success: true,
    data: {
      email: user.email,
      message: "Account created. Enter the verification code we emailed you to log in.",
      // Dev-only convenience so testing never blocks on SMTP being reachable (e.g.
      // Gmail's daily send cap) — never present when NODE_ENV=production.
      ...(process.env.NODE_ENV !== "production" ? { devOtp: otp } : {}),
    },
  });
});

export const verifyEmailHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email, otp } = req.body ?? {};

  if (!email || typeof email !== "string") {
    throw new AppError("email is required", 400);
  }
  if (!otp || typeof otp !== "string") {
    throw new AppError("otp is required", 400);
  }

  const { token, user } = await authService.verifyEmail(email, otp);

  setAuthCookie(res, token);
  res.status(200).json({
    success: true,
    data: {
      token,
      user: toPublicUser(user),
    },
  });
});

export const resendOtpHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body ?? {};

  if (!email || typeof email !== "string") {
    throw new AppError("email is required", 400);
  }

  const { otp } = await authService.resendOtp(email);

  res.status(200).json({
    success: true,
    message: "Verification code resent.",
    ...(process.env.NODE_ENV !== "production" ? { devOtp: otp } : {}),
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

export const updateCandidateProfileHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const headline = body.headline ?? "";
    const about = body.about ?? "";
    if (typeof headline !== "string") {
      throw new AppError("headline must be a string", 400);
    }
    if (typeof about !== "string") {
      throw new AppError("about must be a string", 400);
    }

    let interests: unknown = body.interests ?? [];
    if (typeof interests === "string") {
      try {
        interests = JSON.parse(interests);
      } catch {
        throw new AppError("interests must be a valid JSON array", 400);
      }
    }
    if (
      !Array.isArray(interests) ||
      !interests.every(
        (interest): interest is string => typeof interest === "string",
      )
    ) {
      throw new AppError("interests must be an array of strings", 400);
    }

    const removeAvatarValue = body.removeAvatar;
    if (
      removeAvatarValue !== undefined &&
      removeAvatarValue !== true &&
      removeAvatarValue !== false &&
      removeAvatarValue !== "true" &&
      removeAvatarValue !== "false"
    ) {
      throw new AppError("removeAvatar must be a boolean", 400);
    }

    const user = await candidateProfileService.updateCandidateProfile(
      req.user!._id.toString(),
      {
        headline,
        about,
        interests,
        removeAvatar:
          removeAvatarValue === true || removeAvatarValue === "true",
      },
      req.file,
    );

    res.status(200).json({ success: true, data: toPublicUser(user) });
  },
);

// No auth check needed here — clearing a cookie can't fail based on who's asking,
// so this skips the DB lookup requireAuth would otherwise do on every logout.
export const logoutHandler = (req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
};
