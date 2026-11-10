// Stage 3.3: reading the text of uploaded PDFs. One file at a time, each in a fresh child process with a memory
// limit and a time limit, so a hostile or broken PDF can only fail its own document. No OCR: a scanned PDF has no
// text layer and ends as "no_text". The text is merchant-private, untrusted, and never sent to Gemini; nothing
// here changes an evidence status, the readiness counts, the checklist or a draft.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { pendingPdf, pendingPdfIds, saveExtraction } from "./store.ts";

export const EXTRACTION_LIMITS = {
  maxPages: 20,
  maxPageChars: 200_000,
  maxDocumentChars: 1_000_000,
  timeoutMs: 10_000,
  maxHeapMb: 128,
} as const;

export type ExtractionFailure = "too_many_pages" | "too_much_text" | "encrypted" | "unreadable" | "timeout" | "worker_failed";
export type WorkerResult = { ok: true; pages: { page: number; text: string }[] } | { ok: false; code: ExtractionFailure };
export type ExtractPdf = (bytes: Uint8Array) => Promise<WorkerResult>;

const WORKER = [fileURLToPath(new URL("./extract-worker.ts", import.meta.url))];

// Removes control characters and the invisible bidi embeddings, overrides and isolates (U+202A-202E, U+2066-2069,
// which can make text display in a misleading order), keeping line breaks and tabs. Joiners (ZWJ, ZWNJ) and
// direction marks (LRM, RLM, ALM) stay: Indic, Persian and Arabic text and emoji need them.
export const cleanText = (text: string) =>
  text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{Cc}\n\t]|[‪-‮⁦-⁩]/gu, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

// Parses one PDF in a new child process. Never rejects: a crash, an out-of-memory stop or the time limit gives a
// failure. A process, not a worker thread: the memory pdfjs uses to decompress a file sits outside the JavaScript
// heap limit, so a small file that inflates to gigabytes must crash only its own process, never the server.
// worker (the arguments after node's flags) and timeoutMs are for tests.
export function extractPdf(bytes: Uint8Array, { worker = WORKER, timeoutMs = EXTRACTION_LIMITS.timeoutMs }: { worker?: string[]; timeoutMs?: number } = {}) {
  return new Promise<WorkerResult>((resolve) => {
    let settled = false;
    const finish = (result: WorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(result);
    };
    const child = spawn(process.execPath, [`--max-old-space-size=${EXTRACTION_LIMITS.maxHeapMb}`, ...worker], {
      env: {}, // the parser never sees the server's environment (API keys)
      // Output discarded: the parser's own messages could echo document text into the server log.
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "advanced", // sends the bytes as a Uint8Array
      windowsHide: true,
    });
    const timer = setTimeout(() => finish({ ok: false, code: "timeout" }), timeoutMs);
    child.on("message", (message: WorkerResult) => finish(message));
    child.on("error", () => finish({ ok: false, code: "worker_failed" }));
    child.on("exit", () => finish({ ok: false, code: "worker_failed" }));
    child.send(bytes, (error) => {
      if (error) finish({ ok: false, code: "worker_failed" });
    });
  });
}

export interface Extractor {
  // Queues a document; only a PDF still "pending" is read.
  enqueue(documentId: string): void;
  // Resolves once everything queued so far is saved.
  idle(): Promise<void>;
}

// One document at a time, in upload order. On creation it queues the PDFs left "pending" by an earlier run.
export function createExtractor(db: DatabaseSync, { now = Date.now, extract = (bytes: Uint8Array) => extractPdf(bytes) }: { now?: () => number; extract?: ExtractPdf } = {}): Extractor {
  let chain: Promise<void> = Promise.resolve();
  const run = async (documentId: string) => {
    const bytes = pendingPdf(db, documentId);
    if (!bytes) return; // deleted, already read, or an image
    let result: WorkerResult;
    try {
      result = await extract(bytes);
    } catch {
      result = { ok: false, code: "worker_failed" };
    }
    saveExtraction(db, now(), documentId, result);
  };
  const extractor: Extractor = {
    enqueue(documentId) {
      chain = chain
        .then(() => run(documentId))
        .catch((error: unknown) => {
          // The document ID only: never its name or text.
          console.error(`Could not save the text of document ${documentId}: ${error instanceof Error ? error.message : String(error)}`);
        });
    },
    idle: () => chain,
  };
  for (const id of pendingPdfIds(db)) extractor.enqueue(id);
  return extractor;
}
