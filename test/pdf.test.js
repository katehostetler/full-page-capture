import { describe, it, expect } from "vitest";
import { buildPdf } from "../extension/lib/pdf.js";

const fakeJpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const decode = (bytes) => new TextDecoder("latin1").decode(bytes);

describe("buildPdf", () => {
  it("produces a well-formed single-page PDF", () => {
    const pdf = buildPdf([{ jpeg: fakeJpeg(), width: 100, height: 200 }]);
    const text = decode(pdf);
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);
    expect(text).toContain("/Count 1");
    expect(text).toContain("/Width 100");
    expect(text).toContain("/Height 200");
    expect(text).toContain("/Filter /DCTDecode");
  });

  it("converts pixel dimensions to points in the MediaBox (96dpi -> 72dpi)", () => {
    const text = decode(buildPdf([{ jpeg: fakeJpeg(), width: 100, height: 200 }]));
    expect(text).toContain("/MediaBox [0 0 75.00 150.00]");
  });

  it("creates one page per image for split captures", () => {
    const pages = [
      { jpeg: fakeJpeg(), width: 1000, height: 16000 },
      { jpeg: fakeJpeg(), width: 1000, height: 500 },
    ];
    const text = decode(buildPdf(pages));
    expect(text).toContain("/Count 2");
    expect((text.match(/\/Type \/Page /g) || []).length).toBe(2);
  });

  it("writes a valid xref table whose offsets point at the right objects", () => {
    const pdf = buildPdf([{ jpeg: fakeJpeg(), width: 10, height: 10 }]);
    const text = decode(pdf);
    const xrefOffset = Number(text.match(/startxref\n(\d+)\n/)[1]);
    expect(text.slice(xrefOffset, xrefOffset + 4)).toBe("xref");
    const entries = [...text.matchAll(/^(\d{10}) 00000 n /gm)].map((m) => Number(m[1]));
    entries.forEach((entryOffset, i) => {
      expect(text.slice(entryOffset, entryOffset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  it("embeds the raw JPEG bytes untouched", () => {
    const jpeg = fakeJpeg();
    const pdf = buildPdf([{ jpeg, width: 10, height: 10 }]);
    const needle = decode(jpeg);
    expect(decode(pdf)).toContain(needle);
  });

  it("rejects an empty page list", () => {
    expect(() => buildPdf([])).toThrow();
  });
});
