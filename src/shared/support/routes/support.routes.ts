import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.middleware";
import { createTicketHandler } from "../controller/support.controller";

const router = Router();

router.post("/tickets", requireAuth, createTicketHandler);

export default router;
