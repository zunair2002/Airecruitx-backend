import { Router } from "express";
import {
  signupHandler,
  loginHandler,
  googleLoginHandler,
  verifyEmailHandler,
  resendOtpHandler,
  meHandler,
  logoutHandler,
  updateCandidateProfileHandler,
} from "../controller/auth.controller";
import {
  requireAuth,
  requireRole,
} from "../../../middleware/auth.middleware";
import {
  googleLoginRateLimit,
  loginRateLimit,
  resendOtpRateLimit,
  signupRateLimit,
  verifyEmailRateLimit,
} from "../../../middleware/authRateLimit.middleware";
import { uploadCandidateAvatar } from "../../../middleware/upload.middleware";

import { requestReset, verifyReset, completeReset } from "../controller/passwordReset";

const router = Router();
router.post("/password-reset/request", resendOtpRateLimit, requestReset);
router.post("/password-reset/verify", verifyEmailRateLimit, verifyReset);
router.post("/password-reset/complete", loginRateLimit, completeReset);

router.post("/signup", signupRateLimit, signupHandler);
router.post("/verify-email", verifyEmailRateLimit, verifyEmailHandler);
router.post("/resend-otp", resendOtpRateLimit, resendOtpHandler);
router.post("/login", loginRateLimit, loginHandler);
router.post("/google", googleLoginRateLimit, googleLoginHandler);
router.get("/me", requireAuth, meHandler);
router.patch(
  "/profile",
  requireAuth,
  requireRole("candidate"),
  uploadCandidateAvatar,
  updateCandidateProfileHandler,
);
router.post("/logout", logoutHandler);

export default router;
