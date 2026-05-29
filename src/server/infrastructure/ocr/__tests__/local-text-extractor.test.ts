import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { LocalTextExtractor } from "@server/infrastructure/ocr/local-text-extractor";

const ocr = new LocalTextExtractor();

describe("LocalTextExtractor", () => {
  it("passes plain text through verbatim", async () => {
    const bytes = Buffer.from("hello, world\nthis is a contract\n");
    const result = await ocr.extract({ bytes, mimeType: "text/plain" });
    expect(result.text).toBe("hello, world\nthis is a contract\n");
    expect(result.usedOcr).toBe(false);
    expect(result.pageCount).toBe(1);
    expect(result.pageBreaks).toEqual([]);
    expect(result.providerName).toBe("local");
  });

  it("passes markdown through verbatim", async () => {
    const bytes = Buffer.from("# Renewal\n\n- Term ends 2026-12-31\n");
    const result = await ocr.extract({ bytes, mimeType: "text/markdown" });
    expect(result.text).toContain("Renewal");
    expect(result.text).toContain("2026-12-31");
  });

  it("passes CSV through verbatim", async () => {
    const bytes = Buffer.from("vendor,seats,unit_price\nAcme,10,99.00\n");
    const result = await ocr.extract({ bytes, mimeType: "text/csv" });
    expect(result.text).toContain("Acme");
    expect(result.text).toContain("99.00");
  });

  it("normalizes mime type case", async () => {
    const bytes = Buffer.from("upper-case mime test\n");
    const result = await ocr.extract({ bytes, mimeType: "TEXT/PLAIN" });
    expect(result.text).toContain("upper-case mime test");
  });

  it("returns empty for unknown mime types", async () => {
    const result = await ocr.extract({
      bytes: Buffer.from("???"),
      mimeType: "image/jpeg",
    });
    expect(result.text).toBe("");
    expect(result.pageCount).toBe(0);
  });

  it("extracts text from a real XLSX workbook", async () => {
    // Build a tiny in-memory workbook with two sheets — proves we read every
    // sheet, render the rows, and emit page breaks between sheets.
    const wb = XLSX.utils.book_new();
    const wsPricing = XLSX.utils.aoa_to_sheet([
      ["Product", "Seats", "Unit Price"],
      ["Renewal Radar", 10, 99],
    ]);
    const wsRenewal = XLSX.utils.aoa_to_sheet([
      ["Field", "Value"],
      ["Renewal date", "2027-01-15"],
    ]);
    XLSX.utils.book_append_sheet(wb, wsPricing, "Pricing");
    XLSX.utils.book_append_sheet(wb, wsRenewal, "Renewal");
    const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const result = await ocr.extract({
      bytes,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(result.text).toContain("# Sheet: Pricing");
    expect(result.text).toContain("Renewal Radar");
    expect(result.text).toContain("# Sheet: Renewal");
    expect(result.text).toContain("2027-01-15");
    expect(result.pageCount).toBe(2);
    expect(result.pageBreaks.length).toBe(1);
    expect(result.usedOcr).toBe(false);
  });

  it("extracts text from a real DOCX file", async () => {
    // Build a minimal valid .docx zip in memory. .docx is just OOXML in a zip
    // with at least `word/document.xml` and a `[Content_Types].xml`. mammoth
    // reads paragraph text from the document part.
    const bytes = await buildMinimalDocx(
      "This is a renewal contract for Acme. Notice period is 60 days."
    );
    const result = await ocr.extract({
      bytes,
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(result.text).toContain("renewal contract for Acme");
    expect(result.text).toContain("60 days");
    expect(result.pageCount).toBe(1);
    expect(result.usedOcr).toBe(false);
  });

  it("returns empty for a corrupted DOCX rather than throwing", async () => {
    const result = await ocr.extract({
      bytes: Buffer.from("PK\x03\x04 garbage"),
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(result.text).toBe("");
  });
});

/**
 * Build a minimal valid .docx by hand. .docx is a zip archive — we use the
 * zip writer that ships with the `xlsx` package (it exports a CFB module that
 * can also build OOXML zips). Going through a real builder avoids hand-rolling
 * crc32 / deflate.
 *
 * The minimum-viable docx needs:
 *   - [Content_Types].xml
 *   - _rels/.rels
 *   - word/document.xml
 */
async function buildMinimalDocx(paragraphText: string): Promise<Buffer> {
  // Lazy import jszip via mammoth's own dependency — mammoth depends on jszip
  // so it's always available alongside it.
  const jszip = (await import("jszip")).default;
  const zip = new jszip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${escapeXml(paragraphText)}</w:t></w:r></w:p>
  </w:body>
</w:document>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
