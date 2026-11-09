// Checks for merchant uploads (Stage 3). Pure functions: no database, no file system, no parsing of the file.
import type { DocumentMediaType } from "../../shared/types.ts";
import { DOCUMENT_LIMITS } from "../../shared/types.ts";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const startsWith = (bytes: Uint8Array, sig: number[]) => bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);

// The file's type from its first bytes, or null for anything that is not a PDF, PNG or JPEG.
// The declared Content-Type must agree, so a renamed file is refused.
export function sniffMediaType(bytes: Uint8Array): DocumentMediaType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  return null;
}

// The original filename as display text only: never a path, never in a header. Percent-decoded (the client
// encodes it), NFC-normalised, without control, format (bidi overrides, zero-width) or path characters,
// at most 120 characters. Anything unusable becomes "document".
export function cleanDocumentName(raw: string | undefined): string {
  let name = "";
  try {
    name = decodeURIComponent(raw ?? "");
  } catch {
    name = "";
  }
  const cleaned = name
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/[/\\]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const clipped = [...cleaned].slice(0, DOCUMENT_LIMITS.nameLength).join("").trim();
  return clipped === "" || /^\.+$/.test(clipped) ? "document" : clipped;
}
