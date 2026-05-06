import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import { PDFParse } from 'pdf-parse';
import { toStringOrUndefined } from '../utils/validators.js';

export function extractFirstJsonObject(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('```')) {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch?.[1]) return fenceMatch[1].trim();
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1).trim();
  return text;
}

export function extractFirstJsonArray(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('```')) {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch?.[1]) return fenceMatch[1].trim();
  }
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) return text.slice(start, end + 1).trim();
  return text;
}

export function normalizeSkillIds(raw) {
  const items = Array.isArray(raw) ? raw : [];
  return Array.from(
    new Set(
      items
        .map((item) => Number.parseInt(String(item), 10))
        .filter((item) => Number.isSafeInteger(item) && item > 0)
    )
  );
}

export function normalizeResumeContacts(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const name = toStringOrUndefined(raw.name, 120);
  const lastName = toStringOrUndefined(raw.lastName, 120);
  const phoneNumber = toStringOrUndefined(raw.phoneNumber, 120);
  const email = toStringOrUndefined(raw.email, 254);
  const normalized = {};
  if (name) normalized.name = name;
  if (lastName) normalized.lastName = lastName;
  if (phoneNumber) normalized.phoneNumber = phoneNumber;
  if (email) normalized.email = email;
  return normalized;
}

export function parseResumeContactsJson(jsonValue) {
  if (!jsonValue || typeof jsonValue !== 'string') return {};
  try {
    const parsed = JSON.parse(jsonValue);
    return normalizeResumeContacts(parsed);
  } catch {
    return {};
  }
}

export async function extractResumeTextFromUrl(resumeUrl) {
  const response = await fetch(resumeUrl);
  if (!response.ok) throw new Error(`Failed to download resume by URL: ${response.status}`);
  const mime = (response.headers.get('content-type') || '').toLowerCase();
  const bytes = await response.arrayBuffer();
  const buffer = Buffer.from(bytes);
  if (mime.includes('pdf') || resumeUrl.toLowerCase().endsWith('.pdf')) {
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return (parsed.text || '').trim();
    } finally {
      await parser.destroy();
    }
  }
  if (mime.includes('text/') || resumeUrl.toLowerCase().endsWith('.txt')) {
    return buffer.toString('utf8').trim();
  }
  throw new Error('Resume format is not supported for text extraction; provide PDF or TXT resume.');
}

export async function markdownToPdfBuffer(markdownText) {
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  const regularFontPath = 'C:/Windows/Fonts/arial.ttf';
  const boldFontPath = 'C:/Windows/Fonts/arialbd.ttf';
  const hasUnicodeFonts = existsSync(regularFontPath) && existsSync(boldFontPath);
  if (hasUnicodeFonts) {
    doc.registerFont('resume-regular', regularFontPath);
    doc.registerFont('resume-bold', boldFontPath);
    doc.font('resume-regular');
  } else {
    doc.font('Helvetica');
  }

  const titleFont = hasUnicodeFonts ? 'resume-bold' : 'Helvetica-Bold';
  const bodyFont = hasUnicodeFonts ? 'resume-regular' : 'Helvetica';
  const bodyWidth = 500;
  const sectionTitles = new Set([
    'Professional Summary',
    'Core Competencies',
    'Relevant Experience',
    'Education',
    'Certifications',
    'Skills',
  ]);

  const lines = String(markdownText || '').replace(/\r\n/g, '\n').split('\n');
  let lineIndex = 0;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      doc.moveDown(0.45);
      lineIndex += 1;
      continue;
    }

    if (lineIndex === 0) {
      doc.font(titleFont).fontSize(18).fillColor('#111111').text(trimmed, { width: bodyWidth });
      doc.moveDown(0.2);
      lineIndex += 1;
      continue;
    }
    if (lineIndex === 1) {
      doc.font(bodyFont).fontSize(11).fillColor('#1f2937').text(trimmed, { width: bodyWidth });
      doc.moveDown(0.5);
      lineIndex += 1;
      continue;
    }

    const isBoldHeading = /^\*\*.+\*\*$/.test(trimmed);
    if (isBoldHeading || sectionTitles.has(trimmed)) {
      const headingText = isBoldHeading ? trimmed.replace(/^\*\*|\*\*$/g, '') : trimmed;
      doc
        .font(titleFont)
        .fontSize(13)
        .fillColor('#0f172a')
        .text(headingText, { width: bodyWidth, underline: true });
      doc.moveDown(0.25);
      lineIndex += 1;
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      const bulletText = trimmed.replace(/^[-*•]\s+/, '');
      doc
        .font(bodyFont)
        .fontSize(10.8)
        .fillColor('#111111')
        .text(`• ${bulletText}`, { width: bodyWidth, indent: 14, lineGap: 2 });
      lineIndex += 1;
      continue;
    }

    if (trimmed.includes('/') && trimmed.length <= 140) {
      doc.font(titleFont).fontSize(11.3).fillColor('#111111').text(trimmed, { width: bodyWidth });
      doc.moveDown(0.15);
      lineIndex += 1;
      continue;
    }

    doc
      .font(bodyFont)
      .fontSize(10.8)
      .fillColor('#111111')
      .text(trimmed, { width: bodyWidth, lineGap: 2 });
    lineIndex += 1;
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}
