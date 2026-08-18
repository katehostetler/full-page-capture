// Minimal PDF writer: one JPEG image per page, sized to the image. Pure
// (no DOM/chrome APIs) so it can be unit-tested in vitest. Kept dependency-free
// on purpose — a vendored PDF library would be ~300KB for what is ~80 lines.

const latin1 = (s) => {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return bytes;
};

// Pixels (96dpi) to PDF points (72dpi).
const toPoints = (px) => (px * 0.75).toFixed(2);

/**
 * pages: [{ jpeg: Uint8Array, width, height }] — dimensions in pixels.
 * Returns the complete PDF file as a Uint8Array.
 */
export function buildPdf(pages) {
  if (!pages.length) throw new Error("PDF needs at least one page");
  const chunks = [];
  let offset = 0;
  const offsets = [];
  const push = (data) => {
    const bytes = typeof data === "string" ? latin1(data) : data;
    chunks.push(bytes);
    offset += bytes.length;
  };
  const beginObj = (num) => {
    offsets[num] = offset;
    push(`${num} 0 obj\n`);
  };

  push("%PDF-1.4\n");
  const objCount = 2 + pages.length * 3; // catalog, pages, then (page, contents, image) each
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  beginObj(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  beginObj(2);
  push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, i) => {
    const pageNum = 3 + i * 3;
    const contentNum = pageNum + 1;
    const imageNum = pageNum + 2;
    const w = toPoints(page.width);
    const h = toPoints(page.height);

    beginObj(pageNum);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im${i} ${imageNum} 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`
    );

    const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im${i} Do\nQ\n`;
    beginObj(contentNum);
    push(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

    beginObj(imageNum);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
    );
    push(page.jpeg);
    push("\nendstream\nendobj\n");
  });

  const xrefOffset = offset;
  let xref = `xref\n0 ${objCount + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= objCount; n++) {
    xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(offset);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}
