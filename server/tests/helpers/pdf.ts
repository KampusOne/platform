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

/** Real raster PDF pages with an embedded JPEG and optional native-text pages. */
export function scannedPdfFixture(jpeg:Uint8Array,width:number,height:number,pages:(string|null)[]=[null]):Uint8Array{
  const encoder=new TextEncoder(),parts:Uint8Array[]=[encoder.encode('%PDF-1.4\n')],offsets=[0];let size=parts[0]!.length;
  const append=(part:string|Uint8Array)=>{const bytes=typeof part==='string'?encoder.encode(part):part;parts.push(bytes);size+=bytes.length;};
  const object=(id:number,body:string)=>{offsets.push(size);append(`${id} 0 obj\n${body}\nendobj\n`);};
  object(1,'<< /Type /Catalog /Pages 2 0 R >>');
  object(2,`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${5+i*2} 0 R`).join(' ')}] >>`);
  offsets.push(size);append(`3 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);append(jpeg);append('\nendstream\nendobj\n');
  object(4,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((text,index)=>{
    const id=5+index*2;
    object(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> /XObject << /Im0 3 0 R >> >> /Contents ${id+1} 0 R >>`);
    const stream=text===null?`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`:`BT /F1 20 Tf 20 200 Td (${text.replace(/[\\()]/g,'\\$&')}) Tj ET`;
    object(id+1,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  const xref=size;append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}
