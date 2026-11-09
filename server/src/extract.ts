// Stage 3.3: reading the text of uploaded PDFs. One file at a time, each in a fresh worker thread with a memory
// limit and a time limit, so a hostile or broken PDF can only fail its own document. No OCR: a scanned PDF has no
// text layer and ends as "no_text". The text is merchant-private, untrusted, and never sent to Gemini; nothing
// here changes an evidence status, the readiness counts, the checklist or a draft.
import { Worker } from "node:worker_threads";
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

const WORKER = new URL("./extract-worker.ts", import.meta.url);

// Parses one PDF in a new worker. Never rejects: a crash, an out-of-memory stop or the time limit gives a failure.
// worker and timeoutMs are for tests.
export function extractPdf(bytes: Uint8Array, { worker = WORKER, timeoutMs = EXTRACTION_LIMITS.timeoutMs }: { worker?: URL; timeoutMs?: number } = {}) {
  return new Promise<WorkerResult>((resolve) => {
    let settled = false;
    const finish = (result: WorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void thread.terminate();
      resolve(result);
    };
    const thread = new Worker(worker, {
      workerData: bytes,
      resourceLimits: { maxOldGenerationSizeMb: EXTRACTION_LIMITS.maxHeapMb, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      env: {}, // the worker never sees the server's environment (API keys)
      stdout: true,
      stderr: true,
    });
    // Drained and discarded: the parser's own messages could echo document text into the server log.
    thread.stdout.resume();
    thread.stderr.resume();
    const timer = setTimeout(() => finish({ ok: false, code: "timeout" }), timeoutMs);
    thread.on("message", (message: WorkerResult) => finish(message));
    thread.on("error", () => finish({ ok: false, code: "worker_failed" }));
    thread.on("exit", () => finish({ ok: false, code: "worker_failed" }));
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
