import { describe,expect,it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { stampBookPdf } from "./pdf";
describe("personal book copy",()=>{
  it("stamps every page while preserving the master and page count",async()=>{
    const source=await PDFDocument.create();source.addPage([504,720]);source.addPage([504,720]);
    const master=await source.save();const before=Buffer.from(master);
    const copy=await stampBookPdf(master,"buyer@example.com","MAB-synthetic-order");
    expect(Buffer.from(master).equals(before)).toBe(true);expect(Buffer.from(copy).equals(before)).toBe(false);
    const loaded=await PDFDocument.load(copy);expect(loaded.getPageCount()).toBe(2);expect(loaded.getSubject()).toContain("Personal copy");
    expect(loaded.getPages().every(page=>page.node.Contents() !== undefined)).toBe(true);
  });
});
