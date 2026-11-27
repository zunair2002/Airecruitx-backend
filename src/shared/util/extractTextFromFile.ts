import mammoth from "mammoth";
import { AppError } from "../../utils/AppError";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

// TypeScript (CommonJS) import() ko require() bana deta hai, jo .mjs par fail hota hai.
// Is liye real import() ko Function ke andar rakha hai taake compiler usay na chhede.
const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<PdfJs>;

// Sirf Vercel ko batane ke liye ke ye files function ke saath bhejni hain.
// Ye lines kabhi kuch load nahi karti, sirf file ka path dhoondti hain.
try {
  require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
} catch {
  // ignore
}

// pdfjs-dist is ESM-only, so it's loaded via a dynamic import from this CommonJS project.
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
      // hasEOL preserves line structure (needed for line-based parsing like "Q:/A:/Marks:").
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