import { Router } from "express";
import {
  signupHandler,
  loginHandler,
  googleLoginHandler,
  verifyEmailHandler,
  resendOtpHandler,
  meHandler,
  updateProfileHandler,
  logoutHandler,
  updateCandidateProfileHandler,
} from "../controller/auth.controller";
import { requireAuth } from "../../../middleware/auth.middleware";
import { uploadProfileAvatar } from "../../../middleware/upload.middleware";

const router = Router();

router.post("/signup", signupRateLimit, signupHandler);
router.post("/verify-email", verifyEmailRateLimit, verifyEmailHandler);
router.post("/resend-otp", resendOtpRateLimit, resendOtpHandler);
router.post("/login", loginRateLimit, loginHandler);
router.post("/google", googleLoginRateLimit, googleLoginHandler);
router.get("/me", requireAuth, meHandler);
router.patch("/profile", requireAuth, uploadProfileAvatar, updateProfileHandler);
router.post("/logout", logoutHandler);

export default router;
