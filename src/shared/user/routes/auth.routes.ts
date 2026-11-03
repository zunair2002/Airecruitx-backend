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
import { uploadCandidateAvatar } from "../../../middleware/upload.middleware";

const router = Router();

router.post("/signup", signupHandler);
router.post("/verify-email", verifyEmailHandler);
router.post("/resend-otp", resendOtpHandler);
router.post("/login", loginHandler);
router.post("/google", googleLoginHandler);
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
