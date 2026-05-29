/**
 * Local (no-paid-API) text extractor.
 *
 * Handles the documents people actually drop into a renewal tracker without
 * calling a paid OCR service:
 *
 *   - application/pdf                                    → pdf-parse
 *   - application/vnd.openxml...wordprocessingml.document → mammoth (.docx)
 *   - application/msword                                  → mammoth (legacy .doc — best-effort)
 *   - application/vnd.openxml...spreadsheetml.sheet       → xlsx / SheetJS (.xlsx)
 *   - application/vnd.ms-excel                            → xlsx (.xls)
 *   - text/csv                                            → utf-8 passthrough
 *   - text/plain, text/markdown, text/html                → utf-8 passthrough
 *
 * Image-only PDFs / scanned documents still need a real OCR provider; this
 * extractor returns `usedOcr: true` when the PDF text is suspiciously short
 * so the caller can route to a Mistral-class fallback when configured.
 */
import * as mammoth from "mammoth";
import * as XLSX from "xlsx";
import type { OcrProvider, TextExtractionResult } from "./types";

// pdf-parse v2 transitively requires pdfjs-dist@5's ESM build, which crashes
// Next.js 14's webpack bundler at module-evaluation time with
// "Object.defineProperty called on non-object". That break fires the instant
// this file is imported — even if no PDF is being parsed. Routes that only
// call `getOcrProvider().providerName` (e.g. /api/health, /settings/system-health)
// would 500 just for touching the provider.
//
// Workaround: defer the require until we actually have a PDF in hand. Node's
// CommonJS `require` runs through Next's external-modules path, which sidesteps
// the broken ESM resolution. The result is cached so we only pay the cost once.
//
// pdf-parse v2 ships as ESM with named exports; v1 shipped a default function.
// We adapt at call time so a future bump doesn't break the build.
type PdfParseLike = (
  bytes: Buffer
) => Promise<{ text: string; numpages: number }>;

let cachedPdfParse: PdfParseLike | null = null;

async function loadPdfParse(): Promise<PdfParseLike> {
  if (cachedPdfParse) return cachedPdfParse;
  // Use the runtime `require` so webpack doesn't statically analyze and pull
  // pdfjs-dist into the bundle graph. The pdf-parse package itself is in
  // `serverComponentsExternalPackages` so Next leaves it as a Node require.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("pdf-parse") as {
    default?: PdfParseLike;
    PDFParse?: new (opts: { data: Buffer }) => {
      getText(): Promise<{ text: string; numpages: number }>;
    };
  };
  if (typeof mod.default === "function") {
    cachedPdfParse = mod.default;
    return cachedPdfParse;
  }
  if (mod.PDFParse) {
    const Ctor = mod.PDFParse;
    cachedPdfParse = async (bytes) => {
      const parser = new Ctor({ data: bytes });
      return parser.getText();
    };
    return cachedPdfParse;
  }
  throw new Error(
    "pdf-parse module shape changed; update local-text-extractor.ts"
  );
}

const PROVIDER_NAME = "local";

// Mime aliases — what real-world uploads actually carry. Browsers and OSes
// disagree on canonical strings, so we normalize.
const DOCX_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // Legacy .doc — mammoth's docx path won't help much but we attempt extraction.
  "application/msword",
]);
const XLSX_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);
const PASSTHROUGH_TEXT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "text/html",
  "text/csv",
  // Some uploaders mislabel JSON contract exports as text/plain; if someone
  // genuinely sends application/json we treat it as text — the heuristic
  // extractor reads it just fine.
  "application/json",
]);

export class LocalTextExtractor implements OcrProvider {
  readonly providerName = PROVIDER_NAME;

  async extract(input: {
    bytes: Buffer;
    mimeType: string;
  }): Promise<TextExtractionResult> {
    const mime = input.mimeType.toLowerCase();

    if (mime === "application/pdf") {
      return parsePdf(input.bytes);
    }
    if (DOCX_MIMES.has(mime)) {
      return parseDocx(input.bytes);
    }
    if (XLSX_MIMES.has(mime)) {
      return parseXlsx(input.bytes);
    }
    if (PASSTHROUGH_TEXT_MIMES.has(mime) || mime.startsWith("text/")) {
      return plainText(input.bytes);
    }
    // Unknown mime — return empty so the AI provider produces no fields and
    // the user sees an honest "couldn't extract" state instead of garbage.
    return emptyResult();
  }
}

function emptyResult(): TextExtractionResult {
  return {
    text: "",
    pageCount: 0,
    pageBreaks: [],
    usedOcr: false,
    providerName: PROVIDER_NAME,
  };
}

async function plainText(bytes: Buffer): Promise<TextExtractionResult> {
  const text = bytes.toString("utf-8");
  return {
    text,
    pageCount: 1,
    pageBreaks: [],
    usedOcr: false,
    providerName: PROVIDER_NAME,
  };
}

async function parsePdf(bytes: Buffer): Promise<TextExtractionResult> {
  try {
    // pdf-parse emits one big string with form-feed (\f) separators between
    // pages. We translate those into a cumulative-offset page-break list so
    // the AI provider can attribute quotes to a page.
    const pdfParse = await loadPdfParse();
    const result = await pdfParse(bytes);
    const raw = result.text ?? "";
    const pageCount = result.numpages ?? Math.max(1, raw.split("\f").length);
    const pageBreaks: number[] = [];
    let cursor = 0;
    const pieces = raw.split("\f");
    for (let i = 0; i < pieces.length - 1; i++) {
      cursor += pieces[i]!.length;
      pageBreaks.push(cursor);
      cursor += 1; // account for the \f itself, which we strip below
    }
    const text = pieces.join("");
    // Treat very small extractions as a signal the PDF is image-only.
    const usedOcr = text.trim().length < 100;
    return {
      text,
      pageCount,
      pageBreaks,
      usedOcr,
      providerName: PROVIDER_NAME,
    };
  } catch (err) {
    console.error("[local-text-extractor] pdf parse failed:", err);
    return emptyResult();
  }
}

async function parseDocx(bytes: Buffer): Promise<TextExtractionResult> {
  try {
    // mammoth.extractRawText drops all formatting and gives us paragraph
    // text — which is what the heuristic / AI extractors want.
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    const text = value ?? "";
    return {
      text,
      // mammoth doesn't surface page count (docx pagination is renderer-defined).
      // We report 1 so downstream code doesn't trip; quote attribution falls
      // back to character offsets within the body.
      pageCount: text.trim().length > 0 ? 1 : 0,
      pageBreaks: [],
      usedOcr: false,
      providerName: PROVIDER_NAME,
    };
  } catch (err) {
    console.error("[local-text-extractor] docx parse failed:", err);
    return emptyResult();
  }
}

async function parseXlsx(bytes: Buffer): Promise<TextExtractionResult> {
  try {
    // SheetJS reads any Excel-ish workbook from a buffer. We render each
    // sheet as CSV-with-tabs and label it so the AI provider sees the
    // structure (sheet names often carry semantic info like "Pricing" or
    // "Renewal terms"). \f between sheets gives us natural page breaks.
    const workbook = XLSX.read(bytes, { type: "buffer" });
    const parts: string[] = [];
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
      if (csv.trim().length === 0) continue;
      parts.push(`# Sheet: ${name}\n${csv}`);
    }
    if (parts.length === 0) return emptyResult();

    // Build page-break offsets so a quote on sheet N can be attributed correctly.
    const pageBreaks: number[] = [];
    let cursor = 0;
    for (let i = 0; i < parts.length - 1; i++) {
      cursor += parts[i]!.length;
      pageBreaks.push(cursor);
      cursor += 1; // the \f separator
    }
    const text = parts.join("\f");
    return {
      text,
      pageCount: parts.length,
      pageBreaks,
      usedOcr: false,
      providerName: PROVIDER_NAME,
    };
  } catch (err) {
    console.error("[local-text-extractor] xlsx parse failed:", err);
    return emptyResult();
  }
}
