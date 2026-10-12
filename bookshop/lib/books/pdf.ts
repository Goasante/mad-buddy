import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function stampBookPdf(master: Uint8Array, email: string, reference: string) {
  const pdf = await PDFDocument.load(master);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const label = `Licensed to ${email} | Order ${reference} | Personal use`;
  for (const [index, page] of pdf.getPages().entries()) {
    const { width } = page.getSize();
    const size = Math.min(6.4, (width - 84) / font.widthOfTextAtSize(label, 1));
    // Above the existing footer rule on the approved 504 x 720 master.
    page.drawText(label, { x: 42, y: index === 0 ? 45 : 43, size, font,
      color: index === 0 ? rgb(.72,.59,.35) : rgb(.4,.46,.48) });
  }
  pdf.setSubject("Personal copy of The M&A Prospecting Playbook");
  return pdf.save();
}
