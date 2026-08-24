import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import {
  listSupportTicketsHandler,
  resolveSupportTicketHandler,
} from "../controller/support-desk.controller";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/", listSupportTicketsHandler);
router.patch("/:ticketId/resolve", resolveSupportTicketHandler);

export default router;
