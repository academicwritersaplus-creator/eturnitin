'use strict';
// Builds the downloadable, print-friendly PDF report.
// Every page carries a diagonal "TimCheck - EDUCATIONAL DEMO - NOT A TURNITIN REPORT"
// watermark and a footer with the report reference and verification link.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const config = require('./config');

// Fonts: DejaVu Sans (supports most languages) is looked for next to this file
// (or in assets/fonts). If it is missing, the built-in Helvetica is used.
function findFont(file, fallback) {
  for (const dir of [__dirname, path.join(__dirname, 'assets', 'fonts')]) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) return p;
  }
  return fallback;
}
const FONT = findFont('DejaVuSans.ttf', 'Helvetica');
const FONT_BOLD = findFont('DejaVuSans-Bold.ttf', 'Helvetica-Bold');
const FONT_ITALIC = findFont('DejaVuSans-Oblique.ttf', 'Helvetica-Oblique');

const INK = '#1c2433';
const MUTED = '#5b6577';
const BRAND = '#0f766e';
const WATERMARK = 'TimCheck  •  EDUCATIONAL DEMO  •  NOT A TURNITIN REPORT';
const SOURCE_COLORS = ['#c2410c', '#1d4ed8', '#7e22ce', '#15803d', '#be123c', '#a16207', '#0e7490', '#4338ca'];

function colorFor(index) { return SOURCE_COLORS[index % SOURCE_COLORS.length]; }

function fmtDate(d) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: process.env.REPORT_TIMEZONE || 'UTC',
    timeZoneName: 'short',
  }).format(new Date(d));
}

/**
 * @param {object} doc      documents row (completed)
 * @param {Array}  sources  [{source_id, title, author, origin, words, percent}]
 * @param {Array}  matches  [{source_id, char_start, char_end, word_count, source_excerpt}]
 * @param {stream.Writable} out
 */
function buildReportPdf(doc, sources, matches, out) {
  const pdf = new PDFDocument({
    size: 'A4', margins: { top: 56, bottom: 64, left: 56, right: 56 }, bufferPages: true,
    info: {
      Title: `TimCheck educational demo report ${doc.report_ref}`,
      Author: 'TimCheck (educational demonstration)',
      Subject: 'Independent similarity estimate. Not a Turnitin report.',
      Keywords: 'TimCheck, educational demonstration, not Turnitin',
    },
  });
  pdf.registerFont('body', FONT);
  pdf.registerFont('bold', FONT_BOLD);
  pdf.registerFont('italic', FONT_ITALIC);
  pdf.pipe(out);

  const W = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  const L = pdf.page.margins.left;
  const srcIndex = new Map(sources.map((s, i) => [s.source_id, i]));

  // ---------- header
  pdf.rect(0, 0, pdf.page.width, 6).fill(BRAND);
  pdf.font('bold').fontSize(22).fillColor(BRAND).text('TimCheck', L, 50, { continued: true })
    .font('body').fontSize(11).fillColor(MUTED).text('   Similarity demonstration report');
  pdf.y += 14;

  // ---------- disclaimer box
  const boxY = pdf.y;
  const disclaimer = 'EDUCATIONAL DEMONSTRATION — NOT A TURNITIN REPORT. This report was produced by TimCheck, '
    + 'an independent teaching tool. It compares text only against TimCheck\'s own small collection of sample documents. '
    + 'It is not connected to Turnitin or any other commercial database, and it cannot be used as evidence of originality.';
  pdf.font('body').fontSize(8.5);
  const dh = pdf.heightOfString(disclaimer, { width: W - 20 }) + 16;
  pdf.roundedRect(L, boxY, W, dh, 4).fillAndStroke('#fff7e6', '#f0b44c');
  pdf.fillColor('#7a4b00').text(disclaimer, L + 10, boxY + 8, { width: W - 20 });
  pdf.y = boxY + dh + 16;

  // ---------- summary
  const top = pdf.y;
  const rows = [
    ['Document title', doc.title],
    ['Report reference', doc.report_ref],
    ['Submitted', fmtDate(doc.created_at)],
    ['Report generated', fmtDate(doc.completed_at)],
    ['Total words checked', String(doc.word_count)],
    ['Matched words', String(doc.matched_words)],
    ['Matched passages', String(matches.length)],
    ['Sample sources matched', String(sources.length)],
  ];
  let y = top;
  for (const [k, v] of rows) {
    pdf.font('body').fontSize(9).fillColor(MUTED).text(k, L, y, { width: 130 });
    pdf.font('bold').fontSize(9.5).fillColor(INK).text(v, L + 135, y, { width: W - 135 - 150 });
    y = Math.max(pdf.y, y + 14) + 3;
  }
  // big percentage
  const cx = L + W - 130;
  pdf.roundedRect(cx, top, 130, 92, 6).fill('#eef7f6');
  pdf.font('bold').fontSize(32).fillColor(BRAND).text(`${Number(doc.similarity).toFixed(1)}%`, cx, top + 16, { width: 130, align: 'center' });
  pdf.font('body').fontSize(8.5).fillColor(MUTED).text('similarity estimate\n(demo calculation)', cx, top + 58, { width: 130, align: 'center' });
  pdf.y = Math.max(y, top + 100) + 10;

  if (doc.error_message) {
    pdf.font('italic').fontSize(8.5).fillColor('#9a3412').text(`Note: ${doc.error_message}`, L);
    pdf.moveDown(0.5);
  }

  // ---------- sources
  heading(pdf, 'Matched sample sources', L);
  if (!sources.length) {
    pdf.font('body').fontSize(10).fillColor(MUTED).text('No passages matched the sample collection.', L);
  }
  sources.forEach((s, i) => {
    const yy = pdf.y;
    if (yy > pdf.page.height - 110) pdf.addPage();
    const y2 = pdf.y;
    pdf.rect(L, y2 + 2, 10, 10).fill(colorFor(i));
    pdf.font('bold').fontSize(10).fillColor(INK).text(`[${i + 1}]  ${s.title}`, L + 18, y2, { width: W - 90 });
    const after = pdf.y;
    pdf.font('bold').fontSize(10).fillColor(colorFor(i)).text(`${Number(s.percent).toFixed(1)}%`, L + W - 60, y2, { width: 60, align: 'right' });
    pdf.y = after;
    const meta = [s.author, s.origin, `${s.words} matched words`].filter(Boolean).join(' · ');
    pdf.font('body').fontSize(8.5).fillColor(MUTED).text(meta, L + 18, pdf.y, { width: W - 18 });
    pdf.moveDown(0.5);
  });
  pdf.font('italic').fontSize(8).fillColor(MUTED)
    .text('Sources are TimCheck sample documents written or collected for this demonstration only.', L);

  // ---------- full text with highlights
  pdf.addPage();
  heading(pdf, 'Submitted text with highlighted matches', L);
  pdf.font('body').fontSize(8.5).fillColor(MUTED)
    .text('Coloured, underlined text matched a sample source. The number in brackets shows which source.', L);
  pdf.moveDown(0.6);

  // Single line breaks become spaces (same length, so match offsets stay valid).
  const text = (doc.extracted_text || '').replace(/([^\n])\n(?=[^\n])/g, '$1 ');
  const segs = [];
  let pos = 0;
  for (const m of matches) {
    if (m.char_start > pos) segs.push({ t: text.slice(pos, m.char_start) });
    segs.push({ t: text.slice(m.char_start, m.char_end), src: srcIndex.get(m.source_id) });
    pos = m.char_end;
  }
  if (pos < text.length) segs.push({ t: text.slice(pos) });
  pdf.x = L;
  segs.forEach((s, i) => {
    const last = i === segs.length - 1;
    if (s.src === undefined) {
      pdf.font('body').fontSize(10).fillColor(INK).text(s.t, { continued: !last, lineGap: 3, width: W, underline: false });
    } else {
      pdf.font('bold').fontSize(10).fillColor(colorFor(s.src)).text(s.t, { continued: true, lineGap: 3, width: W, underline: true });
      pdf.font('body').fontSize(7.5).fillColor(colorFor(s.src)).text(` [${s.src + 1}] `, { continued: !last, lineGap: 3, underline: false });
    }
  });
  if (!segs.length) pdf.text('');

  // ---------- passage details
  if (matches.length) {
    pdf.addPage();
    heading(pdf, 'Matched passage details', L);
    const limit = 300;
    matches.slice(0, limit).forEach((m, i) => {
      if (pdf.y > pdf.page.height - 140) pdf.addPage();
      const si = srcIndex.get(m.source_id);
      const s = sources[si];
      pdf.font('bold').fontSize(9).fillColor(colorFor(si))
        .text(`Passage ${i + 1} · ${m.word_count} words · Source [${si + 1}] ${s ? s.title : ''}`, L, pdf.y, { width: W });
      pdf.font('body').fontSize(8.5).fillColor(INK)
        .text(`Submitted: “${clip(text.slice(m.char_start, m.char_end))}”`, L + 10, pdf.y + 2, { width: W - 10 });
      pdf.font('italic').fontSize(8.5).fillColor(MUTED)
        .text(`Sample source: “${clip(m.source_excerpt)}”`, L + 10, pdf.y + 2, { width: W - 10 });
      pdf.moveDown(0.7);
    });
    if (matches.length > limit) {
      pdf.font('italic').fontSize(8.5).fillColor(MUTED).text(`…and ${matches.length - limit} more passages (see the online report).`, L);
    }
  }

  // ---------- how to read
  if (pdf.y > pdf.page.height - 200) pdf.addPage(); else pdf.moveDown(1.2);
  heading(pdf, 'How to read this demonstration', L);
  const notes = [
    'The percentage is matched words divided by total words, using exact runs of 5 or more words.',
    'A high percentage does not prove plagiarism. Quotes, references, common phrases and properly cited material also match.',
    'A low percentage does not prove originality. TimCheck only knows its own small sample collection.',
    `Check this report is unedited: open ${config.appUrl}/#/verify and enter reference ${doc.report_ref}. `
      + `The text fingerprint shown there must be: ${doc.text_sha256}`,
  ];
  notes.forEach(n => {
    pdf.font('body').fontSize(9).fillColor(INK).text(`•  ${n}`, L, pdf.y, { width: W });
    pdf.moveDown(0.3);
  });

  // ---------- watermark + footer on every page
  const range = pdf.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    pdf.switchToPage(p);
    const bottom = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0;
    pdf.save();
    pdf.fillColor(BRAND).opacity(0.08).font('bold').fontSize(19);
    const ww = pdf.widthOfString(WATERMARK);
    for (const fy of [0.2, 0.5, 0.8]) {
      pdf.save();
      pdf.rotate(-32, { origin: [pdf.page.width / 2, pdf.page.height * fy] });
      pdf.text(WATERMARK, pdf.page.width / 2 - ww / 2, pdf.page.height * fy - 10, { lineBreak: false });
      pdf.restore();
    }
    pdf.restore();
    pdf.opacity(1);
    pdf.moveTo(L, pdf.page.height - 44).lineTo(L + W, pdf.page.height - 44).lineWidth(0.5).stroke('#d5dae3');
    pdf.font('bold').fontSize(7.5).fillColor(MUTED)
      .text(`TimCheck educational demonstration. Not a Turnitin report. Ref ${doc.report_ref}`, L, pdf.page.height - 38, { lineBreak: false });
    pdf.font('body').text(`Verify this report at ${config.appUrl}/#/verify`, L, pdf.page.height - 28, { lineBreak: false });
    pdf.text(`Page ${p - range.start + 1} of ${range.count}`, L + W - 60, pdf.page.height - 38, { width: 60, align: 'right', lineBreak: false });
    pdf.page.margins.bottom = bottom;
  }
  pdf.end();
}

function heading(pdf, t, L) {
  pdf.font('bold').fontSize(13).fillColor(INK).text(t, L);
  pdf.moveDown(0.4);
}

function clip(s, n = 400) {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

module.exports = { buildReportPdf, SOURCE_COLORS };
