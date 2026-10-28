import { createHash } from "node:crypto";
import { z } from "zod";

export const projectIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const promptSchema = z.string().trim().min(1).max(8_000);
export const filePathSchema = z
  .string()
  .min(1)
  .max(180)
  .refine((path) => !path.startsWith("/") && !path.includes("\\"))
  .refine((path) => {
    const parts = path.split("/");
    return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
  })
  .refine((path) => /\.(html|css|js|json|md|svg|txt)$/i.test(path));
export const projectNameSchema = z.string().trim().min(1).max(80);
export const projectDescriptionSchema = z.string().trim().max(2_000);

export function fileDocumentId(path: string): string {
  return Buffer.from(path, "utf8").toString("base64url");
}

export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
