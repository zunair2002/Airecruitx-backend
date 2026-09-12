import { Router } from "express";
import {
  signupHandler,
  loginHandler,
  googleLoginHandler,
  verifyEmailHandler,
  resendOtpHandler,
  meHandler,
  logoutHandler,
} from "../controller/auth.controller";
import { requireAuth } from "../../../middleware/auth.middleware";

const router = Router();

router.post("/signup", signupHandler);
router.post("/verify-email", verifyEmailHandler);
router.post("/resend-otp", resendOtpHandler);
router.post("/login", loginHandler);
router.post("/google", googleLoginHandler);
router.get("/me", requireAuth, meHandler);
router.post("/logout", logoutHandler);

export default router;
