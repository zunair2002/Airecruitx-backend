import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import {
  listSupportTicketsHandler,
  resolveSupportTicketHandler,
} from "../controller/support-desk.controller";
import { validate } from "../../../middleware/validate.middleware";
import { ticketIdParamSchema, resolveTicketSchema } from "./support-desk.schema";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/", listSupportTicketsHandler);
router.patch(
  "/:ticketId/resolve",
  validate({ params: ticketIdParamSchema, body: resolveTicketSchema }),
  resolveSupportTicketHandler
);

export default router;
