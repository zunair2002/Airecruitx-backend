import { z } from "zod";

export const objectIdParam = (name: string) =>
  z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, `${name} must be a valid id`);

export const dateTimeString = (message = "must be a valid date/time") =>
  z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), { message });
