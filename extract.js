'use strict';
// Turns an uploaded file into plain text.
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');

function detectType(buffer, filename) {
  const ext = (filename || '').toLowerCase().split('.').pop();
  const head = buffer.subarray(0, 5).toString('latin1');
  if (ext === 'pdf' && head.startsWith('%PDF')) return 'pdf';
  // .docx files are ZIP archives and start with "PK"
  if (ext === 'docx' && head.startsWith('PK')) return 'docx';
  return null;
}

function clean(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/­/g, '')                 // soft hyphens
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractText(buffer, type) {
  if (type === 'text') return clean(buffer.toString('utf8'));
  if (type === 'pdf') {
    const parser = new PDFParse({ data: buffer });
    let data;
    try { data = await parser.getText({ pageJoiner: '\n' }); } finally { await parser.destroy().catch(() => {}); }
    // Re-join words that were hyphenated across a line break ("infec-\ntion").
    // PDFs break lines at the page edge; join those lines back into paragraphs.
    const text = clean((data.text || '').replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2'))
      .replace(/([^\n.!?:])\n(?=[^\n])/g, '$1 ');
    if (!text) throw new Error('No text found in this PDF. It may be a scanned image (OCR is not supported in this demo).');
    return text;
  }
  if (type === 'docx') {
    const { value } = await mammoth.extractRawText({ buffer });
    const text = clean(value || '');
    if (!text) throw new Error('No text found in this Word document.');
    return text;
  }
  throw new Error('Unsupported file type');
}

module.exports = { detectType, extractText, clean };
