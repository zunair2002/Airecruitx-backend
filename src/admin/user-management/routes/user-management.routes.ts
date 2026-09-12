import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import {
  listUsersHandler,
  setUserActiveHandler,
  setUserRoleHandler,
  deleteUserHandler,
} from "../controller/user-management.controller";
import { validate } from "../../../middleware/validate.middleware";
import { userIdParamSchema, setActiveSchema, setRoleSchema } from "./user-management.schema";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/", listUsersHandler);
router.patch(
  "/:userId/active",
  validate({ params: userIdParamSchema, body: setActiveSchema }),
  setUserActiveHandler
);
router.patch(
  "/:userId/role",
  validate({ params: userIdParamSchema, body: setRoleSchema }),
  setUserRoleHandler
);
router.delete("/:userId", validate({ params: userIdParamSchema }), deleteUserHandler);

export default router;
