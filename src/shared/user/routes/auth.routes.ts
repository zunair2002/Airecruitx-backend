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

const router = Router();

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
