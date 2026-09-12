import { Router } from "express";
import {
  signupHandler,
  loginHandler,
  googleLoginHandler,
  meHandler,
  logoutHandler,
} from "../controller/auth.controller";
import { requireAuth } from "../../../middleware/auth.middleware";
import { validate } from "../../../middleware/validate.middleware";
import { signupSchema, loginSchema, googleLoginSchema } from "./auth.schema";

const router = Router();

router.post("/signup", validate({ body: signupSchema }), signupHandler);
router.post("/login", validate({ body: loginSchema }), loginHandler);
router.post("/google", validate({ body: googleLoginSchema }), googleLoginHandler);
router.get("/me", requireAuth, meHandler);
router.post("/logout", logoutHandler);

export default router;
