import { describe, expect, it } from "vitest";
import { PdfParseOnlyOcr } from "@server/infrastructure/ocr/pdf-parse-only";

const ocr = new PdfParseOnlyOcr();

describe("PdfParseOnlyOcr", () => {
  it("passes plain text through verbatim", async () => {
    const bytes = Buffer.from("hello, world\nthis is a contract\n");
    const result = await ocr.extract({ bytes, mimeType: "text/plain" });
    expect(result.text).toBe("hello, world\nthis is a contract\n");
    expect(result.usedOcr).toBe(false);
    expect(result.pageCount).toBe(1);
    expect(result.pageBreaks).toEqual([]);
  });

  it("returns empty for unknown mime types", async () => {
    const result = await ocr.extract({
      bytes: Buffer.from("???"),
      mimeType: "image/jpeg",
    });
    expect(result.text).toBe("");
    expect(result.pageCount).toBe(0);
  });

  it("returns empty for DOCX in the stub (production swap handles this)", async () => {
    const result = await ocr.extract({
      bytes: Buffer.from("PK..."),
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(result.text).toBe("");
  });
});
