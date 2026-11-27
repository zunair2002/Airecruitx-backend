import mammoth from "mammoth";
import { AppError } from "../../utils/AppError";
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

// TypeScript (CommonJS) import() ko require() bana deta hai, jo .mjs par fail hota hai.
// Is liye real import() ko Function ke andar rakha hai taake compiler usay na chhede.
const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<PdfJs>;


// this project's own `pdfkit` dependency for certificates).
const parsePdf = async (buffer: Buffer): Promise<string> => {
const pdfjsLib = await nativeImport("pdfjs-dist/legacy/build/pdf.mjs");

  // Text extraction only (getTextContent) — the renderer/JS-eval paths that would
  // matter for a malicious PDF are never invoked, so nothing further needs disabling.
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  });

  try {
    const doc = await loadingTask.promise;

    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      // Each item carries hasEOL — whether pdf.js detected a line break right after
      // it — so line structure from the original document is preserved instead of
      // every line on the page being joined into one continuous run of text. That
      // structure matters here: line-based parsing (e.g. the "Q:/A:/Marks:" question
      // pool format) would otherwise see one giant blob with no line boundaries.
      const pageText = content.items
        .map((item: any) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
        .join("");
      pageTexts.push(pageText);
    }

    return pageTexts.join("\n");
  } catch (error) {
    console.error("[extractTextFromFile] Error parsing PDF:", error);
    throw new AppError("The uploaded PDF appears to be corrupted or invalid. Please try a different file.", 422);
  } finally {
    await loadingTask.destroy();
  }
};

// Shared PDF/DOCX text extraction — used by both resume parsing and job-description parsing.
export const extractTextFromFile = async (buffer: Buffer, mimetype: string): Promise<string> => {
  if (mimetype === "application/pdf") {
    return parsePdf(buffer);
  }

  // DOCX
  const parsed = await mammoth.extractRawText({ buffer });
  return parsed.value;
};
