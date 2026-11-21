import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { AppError } from "../../../utils/AppError";
import * as userManagementService from "../service/user-management.service";
import { USER_PLANS, UserPlan } from "../../../shared/user/model/user.model";

export const listUsersHandler = asyncHandler(async (req: Request, res: Response) => {
  const { role, search, isActive } = req.query;
  const users = await userManagementService.listUsers({
    role: typeof role === "string" ? role : undefined,
    search: typeof search === "string" ? search : undefined,
    isActive: typeof isActive === "string" ? isActive : undefined,
  });
  res.status(200).json({ success: true, data: users });
});

export const setUserActiveHandler = asyncHandler(async (req: Request, res: Response) => {
  const { isActive } = req.body ?? {};
  if (typeof isActive !== "boolean") {
    throw new AppError("isActive must be a boolean", 400);
  }
  const adminId = req.user!._id.toString();
  const user = await userManagementService.setUserActive(adminId, req.params.userId, isActive);
  res.status(200).json({ success: true, data: user });
});

export const setUserRoleHandler = asyncHandler(async (req: Request, res: Response) => {
  const { role } = req.body ?? {};
  if (!role || typeof role !== "string") {
    throw new AppError("role is required", 400);
  }
  const adminId = req.user!._id.toString();
  const user = await userManagementService.setUserRole(adminId, req.params.userId, role);
  res.status(200).json({ success: true, data: user });
});

export const deleteUserHandler = asyncHandler(async (req: Request, res: Response) => {
  const adminId = req.user!._id.toString();
  await userManagementService.deleteUser(adminId, req.params.userId);
  res.status(200).json({ success: true, message: "User deleted" });
});

// Grants or removes Premium for a candidate. expiresAt (ISO date) is optional; null/absent
// means no end date.
export const setUserPlanHandler = asyncHandler(async (req: Request, res: Response) => {
  const { plan, expiresAt } = req.body ?? {};
  if (!USER_PLANS.includes(plan)) {
    throw new AppError(`plan must be one of: ${USER_PLANS.join(", ")}`, 400);
  }
  let expiry: Date | null = null;
  if (expiresAt !== undefined && expiresAt !== null && expiresAt !== "") {
    expiry = typeof expiresAt === "string" ? new Date(expiresAt) : new Date(NaN);
    if (Number.isNaN(expiry.getTime())) {
      throw new AppError("expiresAt must be a valid date", 400);
    }
  }
  if (plan === "free" && expiry) {
    throw new AppError("expiresAt only applies to the premium plan", 400);
  }
  const adminId = req.user!._id.toString();
  const user = await userManagementService.setUserPlan(adminId, String(req.params.userId), plan as UserPlan, expiry);
  res.status(200).json({ success: true, data: user });
});
