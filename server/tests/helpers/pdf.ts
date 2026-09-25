/** Small real PDF fixtures with accurate offsets, no external generator/runtime. */
export function pdfFixture(pages: (string | null)[]): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const text of pages) {
    const pageId = objects.length + 1;
    const content =
      text === null
        ? "q 20 0 0 20 10 10 cm BI /W 1 /H 1 /CS /RGB /BPC 8 /F /AHx ID FF0000> EI Q"
        : `BT /F1 9 Tf 10 TL 40 740 Td ${text.match(/.{1,100}/g)?.map(line=>`(${line.replace(/[\\()]/g,"\\$&")}) Tj T*`).join(" ")} ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
    );
    objects.push(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, value] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${value}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
