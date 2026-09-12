import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.middleware";
import { createTicketHandler } from "../controller/support.controller";
import { validate } from "../../../middleware/validate.middleware";
import { createTicketSchema } from "./support.schema";

const router = Router();

router.post("/tickets", requireAuth, validate({ body: createTicketSchema }), createTicketHandler);

export default router;
