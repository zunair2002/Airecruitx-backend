import { User, IUser, UserRole } from "../../../shared/user/model/user.model";
import { AppError } from "../../../utils/AppError";
import { logActivity } from "../../activity-log/service/activity-log.service";

const VALID_ROLES: UserRole[] = ["candidate", "hr", "admin"];

interface ListUsersFilter {
  role?: string;
  search?: string;
  isActive?: string;
}

export const listUsers = async (filter: ListUsersFilter): Promise<IUser[]> => {
  const query: Record<string, unknown> = {};
  if (filter.role) query.role = filter.role;
  if (filter.isActive !== undefined) query.isActive = filter.isActive === "true";
  if (filter.search) {
    const regex = new RegExp(filter.search, "i");
    query.$or = [{ name: regex }, { email: regex }];
  }

  return User.find(query).sort({ createdAt: -1 });
};

export const setUserActive = async (
  adminId: string,
  userId: string,
  isActive: boolean
): Promise<IUser> => {
  if (adminId === userId) {
    throw new AppError("Admins cannot change their own active status", 400);
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError("User not found", 404);
  }

  user.isActive = isActive;
  await user.save();

  await logActivity(adminId, "admin", isActive ? "user.activate" : "user.deactivate", "User", userId);

  return user;
};

export const setUserRole = async (
  adminId: string,
  userId: string,
  role: string
): Promise<IUser> => {
  if (adminId === userId) {
    throw new AppError("Admins cannot change their own role", 400);
  }
  if (!VALID_ROLES.includes(role as UserRole)) {
    throw new AppError(`role must be one of: ${VALID_ROLES.join(", ")}`, 400);
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError("User not found", 404);
  }

  const previousRole = user.role;
  user.role = role as UserRole;
  await user.save();

  await logActivity(adminId, "admin", "user.role-change", "User", userId, {
    from: previousRole,
    to: role,
  });

  return user;
};

export const deleteUser = async (adminId: string, userId: string): Promise<void> => {
  if (adminId === userId) {
    throw new AppError("Admins cannot delete their own account", 400);
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError("User not found", 404);
  }

  await User.deleteOne({ _id: userId });
  await logActivity(adminId, "admin", "user.delete", "User", userId, {
    name: user.name,
    email: user.email,
  });
};
