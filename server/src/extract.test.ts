// Stage 3.3: the PDF text extractor, in a real child process, on synthetic PDFs built in test-pdfs.ts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { openDatabase } from "./db.ts";
import { cleanText, createExtractor, EXTRACTION_LIMITS, extractPdf, type WorkerResult } from "./extract.ts";
import { addDocument, getDocumentPages, listAudit, seedDemo } from "./store.ts";
import { DEMO_ACCOUNTS, DEMO_DISPUTES } from "./app.ts";
import { bombPdf, denseTextPdf, emptyPdf, encryptedPdf, imageOnlyPdf, malformedPdf, textPdf } from "./test-pdfs.ts";

test("a text-based PDF gives each page's text, in order", async () => {
  const result = await extractPdf(textPdf([["Synthetic invoice INV-0001", "Total 42.00 USD"], ["Page two line"]]));
  assert.deepEqual(result, {
    ok: true,
    pages: [
      { page: 1, text: "Synthetic invoice INV-0001\nTotal 42.00 USD" },
      { page: 2, text: "Page two line" },
    ],
  });
});

test("an empty PDF and a scanned (image-only) PDF give pages with no text, never OCR", async () => {
  assert.deepEqual(await extractPdf(emptyPdf(2)), { ok: true, pages: [{ page: 1, text: "" }, { page: 2, text: "" }] });
  assert.deepEqual(await extractPdf(imageOnlyPdf(1)), { ok: true, pages: [{ page: 1, text: "" }] });
});

test("a malformed, an encrypted or a non-PDF file fails without stopping the server", async () => {
  assert.deepEqual(await extractPdf(malformedPdf()), { ok: false, code: "unreadable" });
  assert.deepEqual(await extractPdf(encryptedPdf()), { ok: false, code: "encrypted" });
  assert.deepEqual(await extractPdf(new TextEncoder().encode("%PDF-1.7 not really")), { ok: false, code: "unreadable" });
});

test("more than 20 pages is refused before any page is read", async () => {
  assert.equal(EXTRACTION_LIMITS.maxPages, 20);
  assert.equal((await extractPdf(emptyPdf(20))).ok, true);
  assert.deepEqual(await extractPdf(emptyPdf(21)), { ok: false, code: "too_many_pages" });
});

test("more text than allowed on a page, or in the whole document, fails the document", async () => {
  // About 210,000 characters on one page: over the 200,000 limit per page.
  assert.deepEqual(await extractPdf(denseTextPdf(1, 700, 300)), { ok: false, code: "too_much_text" });
  // About 190,000 characters on each of 6 pages: every page is allowed, the 1,000,000 total is not.
  assert.deepEqual(await extractPdf(denseTextPdf(6, 650, 292)), { ok: false, code: "too_much_text" });
  // Under both limits.
  const fine = await extractPdf(denseTextPdf(1, 650, 292));
  assert.ok(fine.ok && fine.pages[0].text.length > 150_000);
});

test("the time limit stops the worker", async () => {
  const started = Date.now();
  assert.deepEqual(await extractPdf(textPdf([["Slow synthetic page"]]), { timeoutMs: 1 }), { ok: false, code: "timeout" });
  assert.ok(Date.now() - started < 5000);
});

test("a worker that crashes, exits or runs out of memory gives worker_failed", async () => {
  const pdf = textPdf([["Synthetic"]]);
  const crash = ["-e", "throw new Error('synthetic crash')"];
  const exit = ["-e", "process.exit(3)"];
  const hog = ["-e", "const a=[];for(;;)a.push(new Array(1e6).fill(1))"];
  for (const worker of [crash, exit, hog]) {
    assert.deepEqual(await extractPdf(pdf, { worker, timeoutMs: 20_000 }), { ok: false, code: "worker_failed" });
  }
});

test("the worker gets no environment variables", async () => {
  process.env.DISPUTEDESK_TEST_SECRET = "synthetic-secret";
  try {
    const leak = ["-e", "process.send({ok:true,pages:[{page:1,text:String(process.env.DISPUTEDESK_TEST_SECRET)}]})"];
    assert.deepEqual(await extractPdf(textPdf([["x"]]), { worker: leak }), { ok: true, pages: [{ page: 1, text: "undefined" }] });
  } finally {
    delete process.env.DISPUTEDESK_TEST_SECRET;
  }
});

test("a decompression bomb is parsed outside the server process, so the server's memory stays flat", async () => {
  // About 64 KB on disk, 64 MB once inflated. In a worker thread, a 256 MB one grew the server by about 570 MB.
  const pdf = bombPdf(64);
  assert.ok(pdf.length < 200_000);
  const before = process.memoryUsage().rss;
  let peak = before;
  const sample = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 10);
  try {
    const result = await extractPdf(pdf);
    assert.ok(result.ok || result.code === "timeout");
  } finally {
    clearInterval(sample);
  }
  assert.ok(peak - before < 40 * 2 ** 20, `server grew by ${Math.round((peak - before) / 2 ** 20)} MB`);
});

test("cleaning keeps the letters, joiners and direction marks of every script, and removes bidi overrides", () => {
  const kept = [
    "ગુજરાતી ઓર્ડર", // Gujarati
    "हिन्दी शिपिंग", // Hindi
    "क्‍ष ક્‍ષ", // conjuncts with a zero-width joiner
    "می‌خواهم", // Persian with a zero-width non-joiner
    "👨‍👩‍👧", // an emoji sequence
    "מספר‏ 123 ؜عربي", // Hebrew right-to-left mark, Arabic letter mark
    "தமிழ் ﬁle", // Tamil, a ligature
  ];
  for (const text of kept) assert.equal(cleanText(text), text);
  assert.equal(cleanText("é"), "é"); // composed (NFC)
  assert.equal(cleanText("abc‮dcba‬ ⁦x⁩"), "abcdcba x"); // overrides and isolates
  assert.equal(cleanText("a\u0000b\u0007c\r\nd\te  \nf"), "abc\nd\te\nf"); // control characters, line endings
});

// ---- The queue and what it saves ----

const NOW = Date.UTC(2026, 10, 9, 12);
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

function setup() {
  const db = openDatabase(":memory:");
  seedDemo(db, DEMO_ACCOUNTS, DEMO_DISPUTES, NOW);
  const upload = (bytes: Uint8Array, media_type: "application/pdf" | "image/png" = "application/pdf") => {
    const result = addDocument(db, NOW, { id: uuid(), account_id: "merchant-a", dispute_id: "DEMO-1001", display_name: "synthetic.pdf", media_type, sha256: sha(bytes) }, bytes);
    assert.ok(result.ok);
    return result.document;
  };
  return { db, upload };
}

test("the queue saves pages with hashes, page counts, statuses and IDs-only audit entries", async () => {
  const { db, upload } = setup();
  const text = upload(textPdf([["Synthetic receipt R-17"], ["<img src=x onerror=alert(1)>"]]));
  const scan = upload(imageOnlyPdf(2));
  const broken = upload(malformedPdf());
  const image = upload(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), "image/png");
  assert.equal(image.status, "no_text", "an image has no text layer and is never sent to the extractor");
  assert.equal(text.status, "pending");

  const extractor = createExtractor(db, { now: () => NOW });
  await extractor.idle();

  const pages = getDocumentPages(db, "DEMO-1001", text.id, "merchant-a")!;
  assert.equal(pages.document.status, "extracted");
  assert.equal(pages.document.page_count, 2);
  assert.deepEqual(pages.pages, [
    { page: 1, text: "Synthetic receipt R-17", text_sha256: sha("Synthetic receipt R-17") },
    // Stored as it is written: it is shown as text, never run.
    { page: 2, text: "<img src=x onerror=alert(1)>", text_sha256: sha("<img src=x onerror=alert(1)>") },
  ]);
  const scanned = getDocumentPages(db, "DEMO-1001", scan.id, "merchant-a")!;
  assert.equal(scanned.document.status, "no_text");
  assert.equal(scanned.document.page_count, 2);
  assert.deepEqual(scanned.pages.map((p) => p.text), ["", ""]);
  const failed = getDocumentPages(db, "DEMO-1001", broken.id, "merchant-a")!;
  assert.equal(failed.document.status, "failed");
  assert.equal(failed.document.page_count, null);
  assert.deepEqual(failed.pages, []);
  assert.equal(getDocumentPages(db, "DEMO-1001", image.id, "merchant-a")!.document.status, "no_text");

  const entries = listAudit(db).filter((e) => e.event.startsWith("document_extract"));
  assert.deepEqual(
    entries.map((e) => [e.event, e.detail]).sort(),
    [
      ["document_extracted", scan.id],
      ["document_extracted", text.id],
      ["document_extraction_failed", `${broken.id} unreadable`],
    ].sort(),
  );
  assert.ok(entries.every((e) => e.account_id === "merchant-a" && e.dispute_id === "DEMO-1001"));
  assert.ok(!JSON.stringify(listAudit(db)).includes("Synthetic receipt"), "no extracted text in the audit log");
});

test("another merchant gets nothing, exactly like a missing document", async () => {
  const { db, upload } = setup();
  const doc = upload(textPdf([["Synthetic"]]));
  await createExtractor(db, { now: () => NOW }).idle();
  assert.ok(getDocumentPages(db, "DEMO-1001", doc.id, "merchant-a"));
  assert.equal(getDocumentPages(db, "DEMO-1001", doc.id, "merchant-b"), null);
  assert.equal(getDocumentPages(db, "DEMO-1003", doc.id, "merchant-b"), null);
  assert.equal(getDocumentPages(db, "DEMO-1001", "00000000-0000-4000-8000-999999999999", "merchant-a"), null);
  assert.ok(getDocumentPages(db, "DEMO-1001", doc.id, null), "admin reads it (read-only)");
});

test("a failed or crashed extraction marks only its own document failed; the queue goes on", async () => {
  const { db, upload } = setup();
  const first = upload(textPdf([["first"]]));
  const second = upload(textPdf([["second"]]));
  let calls = 0;
  const extract = async (bytes: Uint8Array): Promise<WorkerResult> => {
    if (calls++ === 0) throw new Error("synthetic worker failure");
    return extractPdf(bytes);
  };
  await createExtractor(db, { now: () => NOW, extract }).idle();
  assert.equal(getDocumentPages(db, "DEMO-1001", first.id, "merchant-a")!.document.status, "failed");
  assert.equal(getDocumentPages(db, "DEMO-1001", second.id, "merchant-a")!.document.status, "extracted");
  assert.ok(listAudit(db).some((e) => e.detail === `${first.id} worker_failed`));
});

test("a document deleted while it is read stays deleted, and is read only once", async () => {
  const { db, upload } = setup();
  const doc = upload(textPdf([["Synthetic"]]));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let started!: () => void;
  const reading = new Promise<void>((r) => (started = r));
  let calls = 0;
  // Creating the extractor queues the pending PDF; queueing it again must not read it twice.
  const extractor = createExtractor(db, {
    now: () => NOW,
    extract: async (bytes) => {
      calls++;
      started();
      await gate;
      return extractPdf(bytes);
    },
  });
  extractor.enqueue(doc.id);
  await reading;
  db.prepare("DELETE FROM documents WHERE id = ?").run(doc.id);
  release();
  await extractor.idle();
  assert.equal(calls, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM document_pages").get()!.n, 0);
  assert.ok(!listAudit(db).some((e) => e.event.startsWith("document_extract")));
});

test("extraction never changes evidence, access or anything outside the document", async () => {
  const { db, upload } = setup();
  const snapshot = () =>
    JSON.stringify(["disputes", "dispute_evidence", "dispute_access", "gap_confirmations", "document_links"].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all()));
  upload(textPdf([["Tracking number 1Z999 delivered and signed"]]));
  const before = snapshot();
  await createExtractor(db, { now: () => NOW }).idle();
  assert.equal(snapshot(), before);
});
