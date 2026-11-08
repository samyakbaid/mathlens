// Reading an uploaded paper or notes in the browser. The file never leaves the computer as a file;
// only the text we pull out of it is sent with the question.
//   const { text, pages, truncated } = await readDocument(file);

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';

export const MAX_DOCUMENT_CHARS = 120000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ACCEPTED = '.pdf,.txt,.md,.tex,.markdown,application/pdf,text/plain,text/markdown';

let pdfjs = null;

/** @returns {Promise<{ name: string, text: string, pages: number | null, truncated: boolean }>} */
export async function readDocument(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is over 25 MB. Try a smaller file, or just the chapter you need.');
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  let text;
  let pages = null;

  if (isPdf) {
    pdfjs ??= await import(PDFJS);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    pages = pdf.numPages;
    const parts = [];
    let length = 0;
    for (let n = 1; n <= pdf.numPages && length < MAX_DOCUMENT_CHARS; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      // Join the pieces, starting a new line where the PDF does
      const pageText = content.items.map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join('');
      parts.push(`[page ${n}]\n${pageText.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ')}`);
      length += pageText.length;
    }
    text = parts.join('\n\n');
  } else if (/\.(txt|md|markdown|tex)$/i.test(file.name) || file.type.startsWith('text/')) {
    text = await file.text();
  } else {
    throw new Error('MathLens can read PDF, TXT, Markdown and LaTeX (.tex) files.');
  }

  text = text.replace(/\u0000/g, '').trim();
  if (text.length < 40) {
    throw new Error(isPdf ? "There's almost no text in this PDF. It may be a scan (pictures of pages), which MathLens can't read yet." : 'This file looks empty.');
  }
  const truncated = text.length > MAX_DOCUMENT_CHARS;
  return { name: file.name, text: text.slice(0, MAX_DOCUMENT_CHARS), pages, truncated };
}
