import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import {
  listUsersHandler,
  setUserActiveHandler,
  setUserRoleHandler,
  deleteUserHandler,
} from "../controller/user-management.controller";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/", listUsersHandler);
router.patch("/:userId/active", setUserActiveHandler);
router.patch("/:userId/role", setUserRoleHandler);
router.delete("/:userId", deleteUserHandler);

export default router;
