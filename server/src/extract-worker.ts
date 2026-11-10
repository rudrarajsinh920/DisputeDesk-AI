// Runs in its own child process (see extract.ts), which has a memory limit and is killed after a time limit.
// Reads the text layer of a PDF, page by page. No OCR, no rendering, no fonts loaded, no scripts run, no network.
// The text is untrusted: it is returned as plain strings and never interpreted.
import { registerHooks } from "node:module";
import { cleanText, EXTRACTION_LIMITS, type WorkerResult } from "./extract.ts";

// pdfjs loads the native @napi-rs/canvas package when it is installed (an optional dependency, for rendering).
// Text needs no rendering, so this worker refuses to load it even if a later `npm install` puts it on disk.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@napi-rs/")) throw new Error(`${specifier} is not loaded by the text extractor`);
    return next(specifier, context);
  },
});
const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

async function extract(bytes: Uint8Array): Promise<WorkerResult> {
  const task = getDocument({
    data: bytes,
    // No isEvalSupported: this pdfjs version has no eval or new Function path at all (the CVE-2024-4367 class).
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
    stopAtErrors: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    verbosity: 0,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > EXTRACTION_LIMITS.maxPages) return { ok: false, code: "too_many_pages" };
    const pages: { page: number; text: string }[] = [];
    let total = 0;
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      const text = cleanText(content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join(""));
      total += text.length;
      if (text.length > EXTRACTION_LIMITS.maxPageChars || total > EXTRACTION_LIMITS.maxDocumentChars) return { ok: false, code: "too_much_text" };
      pages.push({ page, text });
    }
    return { ok: true, pages };
  } catch (error) {
    return { ok: false, code: (error as { name?: string })?.name === "PasswordException" ? "encrypted" : "unreadable" };
  } finally {
    await task.destroy();
  }
}

// One PDF per process: the bytes arrive once, the result goes back, and the parent then kills this process.
process.once("message", async (bytes) => {
  process.send!(await extract(bytes as Uint8Array));
});
