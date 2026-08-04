import { Router } from "express";
import {
  signupHandler,
  loginHandler,
  googleLoginHandler,
  meHandler,
  logoutHandler,
} from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.post("/signup", signupHandler);
router.post("/login", loginHandler);
router.post("/google", googleLoginHandler);
router.get("/me", requireAuth, meHandler);
router.post("/logout", requireAuth, logoutHandler);

export default router;
