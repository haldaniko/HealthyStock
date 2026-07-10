import { NextFunction, Request, Response } from "express";

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error(error);
  const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 500;
  const message = error instanceof Error && statusCode < 500 ? error.message : "Internal server error";
  return res.status(Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({ message });
}
