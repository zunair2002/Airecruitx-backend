import { z } from "zod";

const ROLES = ["candidate", "hr", "admin"] as const;

export const signupSchema = z.object({
  name: z.string().min(1, "name is required"),
  email: z.string().email("email must be a valid email address"),
  password: z.string().min(6, "password must be at least 6 characters"),
  role: z.enum(ROLES, { errorMap: () => ({ message: `role must be one of: ${ROLES.join(", ")}` }) }),
});

export const loginSchema = z.object({
  email: z.string().email("email must be a valid email address"),
  password: z.string().min(1, "password is required"),
});

export const googleLoginSchema = z.object({
  idToken: z.string().min(1, "idToken is required"),
  role: z.enum(ROLES).optional(),
});
