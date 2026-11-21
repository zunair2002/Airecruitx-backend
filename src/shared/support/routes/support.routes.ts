import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.middleware";
import {
  createTicketHandler,
  getTicketHandler,
  listMyTicketsHandler,
  postMessageHandler,
} from "../controller/support.controller";

const router = Router();

// Any signed-in role. Per-ticket routes are restricted to the ticket's author
// or an admin inside the service (403 otherwise).
router.get("/tickets", requireAuth, listMyTicketsHandler);
router.post("/tickets", requireAuth, createTicketHandler);
router.get("/tickets/:ticketId", requireAuth, getTicketHandler);
router.post("/tickets/:ticketId/messages", requireAuth, postMessageHandler);

export default router;
