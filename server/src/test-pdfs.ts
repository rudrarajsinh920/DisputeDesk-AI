// Synthetic PDFs for the extraction tests, built in code so no binary fixture sits in the repository.
// Every file is made up for testing; none comes from a real merchant or order.
import { deflateSync } from "node:zlib";

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

// Assembles numbered objects into a PDF with a correct cross-reference table.
// objects[0] is object 1, and object 1 is the catalog.
function assemble(objects: string[], trailerExtra = ""): Uint8Array {
  let out = "%PDF-1.7\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${trailerExtra} >>\nstartxref\n${xref}\n%%EOF\n`;
  return latin1(out);
}

const stream = (content: string, dict = "") => `<< /Length ${content.length}${dict} >>\nstream\n${content}\nendstream`;
const escapeText = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

// Pages built from content streams. Objects: 1 catalog, 2 page tree, 3 font, any extra objects, then a page and its
// content per page.
function pagesPdf(contents: string[], resources = "/Font << /F1 3 0 R >>", extraObjects: string[] = [], trailerExtra = ""): Uint8Array {
  const first = 4 + extraObjects.length;
  const kids = contents.map((_, i) => `${first + i * 2} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${contents.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ...extraObjects,
  ];
  contents.forEach((content, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ${resources} >> /Contents ${first + i * 2 + 1} 0 R >>`);
    objects.push(stream(content));
  });
  return assemble(objects, trailerExtra);
}

// One text line per entry, each on its own line of the page.
const textContent = (lines: string[]) =>
  lines.map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 18} Td (${escapeText(line)}) Tj ET`).join("\n");

// A text-based PDF: pages[i] holds the lines of page i + 1.
export const textPdf = (pages: string[][]) => pagesPdf(pages.map(textContent));

// Pages packed with text in a 1-point font, so hundreds of long lines fit on the page (text off the page is not
// read). Each page gets `lines` lines of `width` characters.
export const denseTextPdf = (pageCount: number, lines: number, width: number) =>
  pagesPdf(
    Array.from({ length: pageCount }, (_, p) =>
      Array.from({ length: lines }, (_, i) => `BT /F1 1 Tf 10 ${780 - i} Td (${String(p * lines + i).padStart(7, "0")}${"x".repeat(width - 7)}) Tj ET`).join("\n"),
    ),
  );

// A PDF whose pages draw nothing.
export const emptyPdf = (pageCount = 1) => pagesPdf(Array.from({ length: pageCount }, () => ""));

// A "scanned" PDF: each page only draws a picture (a 2x2 grey image), with no text layer.
export const imageOnlyPdf = (pageCount = 1) =>
  pagesPdf(
    Array.from({ length: pageCount }, () => "q 300 0 0 300 100 300 cm /Im1 Do Q"),
    "/Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >>",
    [stream("\x10\x80\x80\xf0", " /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8")],
  );

// Starts like a PDF, then stops: no page tree, no cross-reference table.
export const malformedPdf = () => latin1("%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R\n");

// A decompression bomb: a small file whose one page's content inflates to `megabytes` MB of spaces.
export const bombPdf = (megabytes: number) =>
  assemble([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
    stream(deflateSync(Buffer.alloc(megabytes * 2 ** 20, 0x20), { level: 9 }).toString("latin1"), " /Filter /FlateDecode"),
  ]);

// A PDF with a password-protection dictionary whose check never passes, so it can't be opened.
export const encryptedPdf = () => {
  const pad = "\x28".repeat(32);
  return pagesPdf(
    [textContent(["Locked synthetic page"])],
    "/Font << /F1 3 0 R >>",
    [`<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O (${escapeText(pad)}) /U (${escapeText(pad)}) >>`],
    " /Encrypt 4 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]",
  );
};
