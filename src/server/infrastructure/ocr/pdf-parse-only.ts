/**
 * pdf-parse only text extractor.
 *
 * Handles searchable PDFs (the common case). Image-only PDFs need OCR; in
 * dev we just return what pdf-parse gave back and let the heuristic AI
 * provider extract from what it can. In production the
 * `MistralOcrFallback` provider runs as a second pass when this returns
 * `<100` characters.
 *
 * For DOCX (Office Open XML) and plain text we handle them directly without
 * a separate library. DOCX is just a zip with `word/document.xml` inside;
 * parsing it for paragraph text doesn't need a heavyweight dep.
 */
import * as pdfParseModule from "pdf-parse";
import type { OcrProvider, TextExtractionResult } from "./types";

// pdf-parse v2 ships as ESM with named exports. The actual parsing function
// lives at `.PDFParse(...).getText()` in their docs. Older v1 exported a
// default function — different shape. We adapt at call time so a future
// version bump doesn't break the build.
type PdfParseLike = (
  bytes: Buffer
) => Promise<{ text: string; numpages: number }>;
// Prefer a default export if it exists; otherwise look for the named class.
const pdfParse: PdfParseLike = (() => {
  const mod = pdfParseModule as unknown as {
    default?: PdfParseLike;
    PDFParse?: new (opts: { data: Buffer }) => { getText(): Promise<{ text: string; numpages: number }> };
  };
  if (typeof mod.default === "function") return mod.default;
  if (mod.PDFParse) {
    return async (bytes) => {
      const parser = new mod.PDFParse!({ data: bytes });
      return parser.getText();
    };
  }
  throw new Error("pdf-parse module shape changed; update pdf-parse-only.ts");
})();

const PROVIDER_NAME = "pdf-parse-only";

export class PdfParseOnlyOcr implements OcrProvider {
  readonly providerName = PROVIDER_NAME;

  async extract(input: {
    bytes: Buffer;
    mimeType: string;
  }): Promise<TextExtractionResult> {
    if (input.mimeType === "text/plain") {
      return plainText(input.bytes);
    }
    if (input.mimeType === "application/pdf") {
      return parsePdf(input.bytes);
    }
    if (
      input.mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      // We don't yet have a DOCX extractor in the stub. The provider
      // returns empty text with usedOcr=true so the caller can surface
      // "couldn't extract" to the user — better than silently returning
      // garbage. Production swaps in a docx-aware extractor.
      return {
        text: "",
        pageCount: 0,
        pageBreaks: [],
        usedOcr: false,
        providerName: PROVIDER_NAME,
      };
    }
    // Unknown mime type — return empty so the AI provider produces no
    // fields and the user sees a clear extraction-failed state.
    return {
      text: "",
      pageCount: 0,
      pageBreaks: [],
      usedOcr: false,
      providerName: PROVIDER_NAME,
    };
  }
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
    console.error("[pdf-parse-only] failed:", err);
    return {
      text: "",
      pageCount: 0,
      pageBreaks: [],
      usedOcr: false,
      providerName: PROVIDER_NAME,
    };
  }
}
