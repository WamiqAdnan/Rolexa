import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Pull plain text out of a PDF, DOCX or TXT file. */
export async function extractText(path: string, mimeType: string, fileName: string): Promise<string> {
  const kind = classify(mimeType, fileName);

  switch (kind) {
    case "pdf":
      return normalise(await readPdf(path));
    case "docx":
      return normalise(await readDocx(path));
    case "txt":
      return normalise(await readFile(path, "utf8"));
    default:
      throw new Error(
        `Unsupported file type "${mimeType || fileName}". Upload a PDF, DOCX or TXT.`,
      );
  }
}

export function classify(mimeType: string, fileName: string): "pdf" | "docx" | "txt" | "other" {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (mimeType === "application/pdf" || ext === "pdf") return "pdf";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    return "docx";
  }
  if (mimeType.startsWith("text/") || ext === "txt" || ext === "md") return "txt";
  return "other";
}

async function readPdf(path: string): Promise<string> {
  // Import the library entry point directly: pdf-parse's index.js runs a
  // debug harness that reads a fixture file when it thinks it's the main
  // module, which throws inside a bundled server.
  const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
    b: Buffer,
  ) => Promise<{ text: string }>;
  const buffer = await readFile(path);
  const result = await pdfParse(buffer);
  if (!result.text.trim()) {
    throw new Error(
      "No text found in this PDF. It is probably a scan — export a text-based " +
        "PDF or upload a DOCX instead.",
    );
  }
  return result.text;
}

async function readDocx(path: string): Promise<string> {
  const mammoth = require("mammoth") as {
    extractRawText: (o: { path: string }) => Promise<{ value: string }>;
  };
  const { value } = await mammoth.extractRawText({ path });
  if (!value.trim()) throw new Error("No text found in this DOCX file.");
  return value;
}

/**
 * Tidy the raw text without dropping structure: PDF extraction tends to leave
 * ragged whitespace, stray bullet glyphs and hard-wrapped lines.
 */
function normalise(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[•●▪·‣⁃]/g, "- ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
