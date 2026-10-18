import { Request, Response, NextFunction } from "express";

const COLOR = process.stdout.isTTY;
const paint = (code: number, text: string) => (COLOR ? `\x1b[${code}m${text}\x1b[0m` : text);
const statusColor = (status: number) => (status >= 500 ? 31 : status >= 400 ? 33 : status >= 300 ? 36 : 32);

/**
 * One line per request once the response is sent:
 *   [14:31:21] POST /api/interview/answer 200 1840ms candidate:ali@x.com
 * For a failed request, the error message the client received is appended.
 * Bodies are never logged (they carry passwords, tokens and answers).
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const started = process.hrtime.bigint();
  let errorMessage: string | undefined;

  // Capture the `message` of an error envelope ({ success: false, message }) as it is sent.
  const json = res.json.bind(res);
  res.json = (body?: any) => {
    if (body && body.success === false && typeof body.message === "string") errorMessage = body.message;
    return json(body);
  };

  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
    const who = req.user ? ` ${req.user.role}:${req.user.email}` : "";
    const error = errorMessage ? paint(90, ` — ${errorMessage}`) : "";
    console.log(
      `[${time}] ${req.method} ${req.originalUrl} ${paint(statusColor(res.statusCode), String(res.statusCode))} ${ms.toFixed(0)}ms${who}${error}`
    );
  });

  next();
};
