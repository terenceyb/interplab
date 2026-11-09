/**
 * 文档解析内核：稿件（Word / 纯文本 / 字幕）与幻灯片（PPT / PPTX / PDF / ODP）
 *
 * 设计要点：
 * 1) 永不把二进制当文本读——旧版 .doc/.ppt 等会给出明确提示，而不是显示一堆乱码；
 * 2) 编码识别顺序 BOM → 严格 UTF-8 → XML 声明 → jschardet → GB18030 兜底，
 *    WPS / Office 导出的 GBK XML 也能正确解码；
 * 3) 解析结果保留「块级结构」（标题 / 段落 / 列表），带稿同传才能还原原文换行；
 * 4) 大文件按需解析，解析器全部动态 import，避免拖慢首屏与常驻内存。
 */

import type { DocBlock, SlideData } from '@/types';
import { putAudio, uid } from '@/lib/db';
export type { DocBlock, SlideData };

/** 解析结果 */
export interface ParsedDoc {
  /** slides：有分页信息（PPT/PDF/ODP）；text：连续文稿 */
  kind: 'text' | 'slides';
  /** 纯文本（幻灯片为各页文本拼接），用于对齐、术语提取 */
  text: string;
  /** 结构化块（保留标题/段落/列表），text 类文件用于还原排版 */
  blocks?: DocBlock[];
  slides?: SlideData[];
  /** 文本类文件检测到的编码 */
  encoding?: string;
  /** 原始扩展名 */
  ext: string;
  /** 解析来源，用于界面提示 */
  source: string;
  /** 解析过程中的降级/提示信息 */
  warnings?: string[];
}

/* ------------------------------------------------------------------ */
/* 字节解码                                                            */
/* ------------------------------------------------------------------ */

function decodeBytes(bytes: Uint8Array, label: string): string | null {
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

/** 替换字符 / 控制字符占比，用于判断解码是否正确 */
function badRatio(s: string): number {
  if (!s) return 0;
  let bad = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0xfffd) bad++;
    else if (c < 0x09 && c !== 0x0a && c !== 0x0d) bad++;
  }
  return bad / s.length;
}

/** 二进制嗅探：出现 NUL 或大量不可打印字节即判定为二进制 */
export function looksBinary(bytes: Uint8Array, sample = 4096): boolean {
  const n = Math.min(bytes.length, sample);
  if (!n) return false;
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return true;
    if (b < 0x09 || (b > 0x0d && b < 0x20)) ctrl++;
  }
  return ctrl / n > 0.02;
}

/** 从 XML 头部声明的 encoding 取编码名 */
function xmlEncoding(bytes: Uint8Array): string | null {
  const head = decodeBytes(bytes.subarray(0, Math.min(bytes.length, 300)), 'utf-8') || '';
  const m = head.match(/<\?xml[^>]*encoding\s*=\s*["']([\w\-:.]+)["']/i);
  if (!m) return null;
  const enc = m[1].toLowerCase();
  const map: Record<string, string> = {
    'utf-8': 'utf-8',
    utf8: 'utf-8',
    gbk: 'gb18030',
    gb2312: 'gb18030',
    gb18030: 'gb18030',
    big5: 'big5',
    'utf-16': 'utf-16le',
    'utf-16le': 'utf-16le',
    'iso-8859-1': 'windows-1252',
  };
  return map[enc] ?? enc;
}

/**
 * 解码 XML 字节流。
 * JSZip 的 `.async('string')` 一律按 UTF-8 解码，遇到 GBK 声明的 XML 会整页乱码，
 * 因此这里自己按「BOM → 声明 → 严格 UTF-8 → GB18030」顺序解码。
 */
export function decodeXmlBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return decodeBytes(bytes.subarray(3), 'utf-8') ?? '';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeBytes(bytes, 'utf-16le') ?? '';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeBytes(bytes.subarray(2), 'utf-16be') ?? '';

  const declared = xmlEncoding(bytes);
  if (declared && declared !== 'utf-8') {
    const s = decodeBytes(bytes, declared);
    if (s && badRatio(s) < 0.01) return s;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    /* 非合法 UTF-8，继续兜底 */
  }
  const gb = decodeBytes(bytes, 'gb18030');
  if (gb && badRatio(gb) < 0.01) return gb;
  return decodeBytes(bytes, 'utf-8') ?? '';
}

/** jschardet 结果 → TextDecoder label */
const ENC_MAP: Record<string, string> = {
  'UTF-8': 'utf-8',
  UTF8: 'utf-8',
  ASCII: 'utf-8',
  GB2312: 'gb18030',
  GBK: 'gb18030',
  GB18030: 'gb18030',
  'ISO-8859-1': 'gb18030',
  'windows-1252': 'gb18030',
  Big5: 'big5',
  BIG5: 'big5',
  Shift_JIS: 'shift_jis',
  'EUC-JP': 'euc-jp',
  'EUC-KR': 'euc-kr',
  UTF16: 'utf-16le',
  'UTF-16LE': 'utf-16le',
  'UTF-16BE': 'utf-16be',
  'KOI8-R': 'koi8-r',
  'windows-1251': 'windows-1251',
};

/**
 * 读取纯文本并自动识别编码。
 * 顺序：BOM → 严格 UTF-8 → jschardet → GB18030 兜底。
 */
export async function readTextAuto(file: Blob): Promise<{ text: string; encoding: string }> {
  const buf = new Uint8Array(await file.arrayBuffer());

  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: decodeBytes(buf.subarray(3), 'utf-8') ?? '', encoding: 'UTF-8 (BOM)' };
  }
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: decodeBytes(buf, 'utf-16le') ?? '', encoding: 'UTF-16LE (BOM)' };
  }
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: decodeBytes(buf.subarray(2), 'utf-16be') ?? '', encoding: 'UTF-16BE (BOM)' };
  }
  try {
    const strict = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { text: strict, encoding: 'UTF-8' };
  } catch {
    /* 不是合法 UTF-8，继续猜 */
  }

  let label = '';
  try {
    const { default: jschardet } = await import('jschardet');
    const det = jschardet.detect(buf as unknown as Buffer);
    if (det?.encoding) label = ENC_MAP[det.encoding] ?? '';
  } catch {
    /* 探测失败不阻塞 */
  }
  if (label) {
    const txt = decodeBytes(buf, label);
    if (txt && badRatio(txt) < 0.01) return { text: txt, encoding: label.toUpperCase() };
  }

  const gb = decodeBytes(buf, 'gb18030');
  if (gb && badRatio(gb) < 0.01) return { text: gb, encoding: 'GB18030' };

  return { text: decodeBytes(buf, 'utf-8') ?? '', encoding: 'UTF-8 (强制)' };
}

/* ------------------------------------------------------------------ */
/* 纯文本 → 块结构                                                     */
/* ------------------------------------------------------------------ */

const clean = (s: string) =>
  s
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trimEnd();

/**
 * 把纯文本切成「块」：
 * - 空行分段，段内换行合并为空格（Word 里的软换行不破坏句子）；
 * - `#` 开头 → 标题；`-`/`•`/`·`/`1.` 开头 → 列表项；`>` → 引用。
 */
export function textToBlocks(raw: string): DocBlock[] {
  const lines = clean(raw).split('\n');
  const out: DocBlock[] = [];
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join(' ').replace(/\s+/g, ' ').trim();
    if (text) out.push({ type: 'para', text });
    buf = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      out.push({ type: 'heading', text: heading[2].trim(), level: heading[1].length });
      continue;
    }
    const li = line.match(/^(?:[-•·▪◦*]|\d{1,2}[.)、])\s+(.*)$/);
    if (li) {
      flush();
      out.push({ type: 'li', text: li[1].trim() });
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      out.push({ type: 'quote', text: line.replace(/^>\s?/, '').trim() });
      continue;
    }
    buf.push(line);
  }
  flush();

  if (!out.length) {
    const t = clean(raw).trim();
    if (t) out.push({ type: 'para', text: t });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Word (.docx)                                                        */
/* ------------------------------------------------------------------ */

const BLOCK_TAGS = /^(P|H1|H2|H3|H4|H5|H6|LI|BLOCKQUOTE|TD|TH|PRE|DIV)$/;

/** mammoth 输出的 HTML → 块结构（保留标题层级、列表、引用、表格行） */
function htmlToBlocks(html: string): DocBlock[] {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root');
  const out: DocBlock[] = [];
  if (!root) return out;

  const pushText = (type: DocBlock['type'], text: string, level?: number) => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t) out.push({ type, text: t, level });
  };

  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName;
      if (/^H[1-6]$/.test(tag)) {
        pushText('heading', child.textContent || '', Math.min(4, Number(tag[1])));
        continue;
      }
      if (tag === 'P') {
        pushText('para', child.textContent || '');
        continue;
      }
      if (tag === 'BLOCKQUOTE') {
        pushText('quote', child.textContent || '');
        continue;
      }
      if (tag === 'UL' || tag === 'OL') {
        for (const li of Array.from(child.querySelectorAll(':scope > li'))) {
          pushText('li', li.textContent || '');
        }
        continue;
      }
      if (tag === 'TABLE') {
        for (const tr of Array.from(child.querySelectorAll('tr'))) {
          const cells = Array.from(tr.children).map((c) => (c.textContent || '').trim());
          if (cells.some(Boolean)) pushText('para', cells.join(' | '));
        }
        continue;
      }
      if (tag === 'PRE') {
        pushText('para', child.textContent || '');
        continue;
      }
      if (BLOCK_TAGS.test(tag)) walk(child);
      else {
        // 行内标签聚合成段
        const t = (child.textContent || '').trim();
        if (t) pushText('para', t);
      }
    }
  };
  walk(root);
  return out;
}

async function parseDocx(file: Blob, warnings: string[]): Promise<ParsedDoc> {
  const mod = (await import('mammoth/mammoth.browser.js')).default as any;
  const arrayBuffer = await file.arrayBuffer();
  let blocks: DocBlock[] = [];
  try {
    // 转 HTML 才能拿到标题/列表/表格的结构，extractRawText 会丢掉层级
    const res = await mod.convertToHtml({ arrayBuffer }, { includeDefaultStyleMap: true });
    blocks = htmlToBlocks(String(res.value || ''));
    if (!blocks.length) throw new Error('empty-html');
  } catch {
    warnings.push('HTML 结构解析降级为纯文本');
    const res = await mod.extractRawText({ arrayBuffer });
    blocks = textToBlocks(String(res.value || ''));
  }
  const text = blocks.map((b) => (b.type === 'li' ? `· ${b.text}` : b.text)).join('\n');
  return { kind: 'text', text, blocks, ext: 'docx', source: 'Word', encoding: 'OOXML', warnings };
}

/** Word 2003 XML（WordprocessingML 单文件） */
async function parseWord2003Xml(file: Blob, warnings: string[]): Promise<ParsedDoc> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const xml = decodeXmlBytes(buf);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const paras = Array.from(doc.getElementsByTagName('w:p'));
  const blocks: DocBlock[] = [];
  for (const p of paras) {
    const ts = Array.from(p.getElementsByTagName('w:t')).map((t) => t.textContent || '');
    const text = ts.join('').trim();
    if (text) blocks.push({ type: 'para', text });
  }
  if (!blocks.length) throw new Error('Word 2003 XML 中没有可读文本');
  warnings.push('旧版 Word XML：仅提取正文文字');
  return {
    kind: 'text',
    text: blocks.map((b) => b.text).join('\n'),
    blocks,
    ext: 'xml',
    source: 'Word 2003 XML',
    encoding: 'WordprocessingML',
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* PowerPoint (.pptx / .pptm / .ppsx / .potx)                          */
/* ------------------------------------------------------------------ */

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

type XmlDoc = Document;

function parseXml(text: string): XmlDoc | null {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return null;
    return doc;
  } catch {
    return null;
  }
}

/** 段落文字：a:t + a:br(换行) + a:fld(字段) */
function paraText(p: Element): string {
  let s = '';
  for (const node of Array.from(p.getElementsByTagNameNS(NS_A, 't'))) s += node.textContent || '';
  return s.replace(/\s+/g, ' ').trim();
}

/** 取一页幻灯片的标题与正文（覆盖普通形状、组合形状、表格、SmartArt） */
function parseSlideXml(xml: string): { title?: string; bullets: string[]; paragraphs: number } {
  const doc = parseXml(xml);
  if (!doc) {
    // XML 损坏时用正则兜底，至少不丢文字
    const ts = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) =>
      m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim(),
    );
    return { title: ts[0], bullets: ts.slice(1).filter(Boolean), paragraphs: ts.length };
  }

  let title: string | undefined;
  const bullets: string[] = [];
  const seen = new Set<Element>();
  let paragraphs = 0;

  const takeParas = (host: Element, isTitleCandidate: boolean) => {
    for (const p of Array.from(host.getElementsByTagNameNS(NS_A, 'p'))) {
      if (seen.has(p)) continue;
      seen.add(p);
      const txt = paraText(p);
      if (!txt) continue;
      paragraphs++;
      if (isTitleCandidate && !title && txt.length <= 120) {
        title = txt;
      } else {
        bullets.push(txt);
      }
    }
  };

  // 1) 表格：同一行的单元格合成一行（a:tbl 不在 p:sp 内部，需单独处理）
  for (const tbl of Array.from(doc.getElementsByTagNameNS(NS_A, 'tbl'))) {
    for (const tr of Array.from(tbl.getElementsByTagNameNS(NS_A, 'tr'))) {
      const line: string[] = [];
      for (const tc of Array.from(tr.getElementsByTagNameNS(NS_A, 'tc'))) {
        for (const p of Array.from(tc.getElementsByTagNameNS(NS_A, 'p'))) seen.add(p);
        const cellText = Array.from(tc.getElementsByTagNameNS(NS_A, 't'))
          .map((t) => t.textContent || '')
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        if (cellText) line.push(cellText);
      }
      if (line.length) {
        bullets.push(line.join(' | '));
        paragraphs++;
      }
    }
  }

  // 2) 普通形状：先处理标题占位符，保证标题顺序正确
  const shapes = Array.from(doc.getElementsByTagNameNS(NS_P, 'sp'));
  const titleShapes: Element[] = [];
  const bodyShapes: Element[] = [];
  for (const sp of shapes) {
    const ph = sp.getElementsByTagNameNS(NS_P, 'ph')[0];
    const type = ph?.getAttribute('type') || '';
    const idx = ph?.getAttribute('idx');
    if (type === 'title' || type === 'ctrTitle' || (idx === '0' && !type)) titleShapes.push(sp);
    else bodyShapes.push(sp);
  }
  for (const sp of titleShapes) takeParas(sp, true);
  for (const sp of bodyShapes) takeParas(sp, false);

  // 3) SmartArt / 图表等 graphicFrame 内的剩余文字
  for (const frame of Array.from(doc.getElementsByTagNameNS(NS_P, 'graphicFrame'))) {
    takeParas(frame, false);
  }

  return { title, bullets, paragraphs };
}

/** 目标路径归一化为 zip 内路径（../media/x.png → ppt/media/x.png） */
function normTarget(base: string, target: string): string {
  if (!target) return '';
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1).concat(target.split('/'));
  const stack: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return stack.join('/');
}

/** 解析 rels，返回 id → {target,type} */
function parseRels(xml: string): Map<string, { target: string; type: string }> {
  const map = new Map<string, { target: string; type: string }>();
  const doc = parseXml(xml);
  if (!doc) return map;
  const rels = doc.getElementsByTagNameNS(NS_REL, 'Relationship').length
    ? Array.from(doc.getElementsByTagNameNS(NS_REL, 'Relationship'))
    : Array.from(doc.getElementsByTagName('Relationship'));
  for (const rel of rels) {
    map.set(rel.getAttribute('Id') || '', {
      target: rel.getAttribute('Target') || '',
      type: rel.getAttribute('Type') || '',
    });
  }
  return map;
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  emf: 'image/emf',
  wmf: 'image/wmf',
};

/**
 * 幻灯片顺序：以 presentation.xml 的 sldIdLst 为准；
 * 缺失时按 slideN.xml 的数字排序（注意 1,2,10 这类需要按数值比较）。
 */
async function slideOrder(zip: any): Promise<string[]> {
  const pres = zip.file('ppt/presentation.xml');
  const relsFile = zip.file('ppt/_rels/presentation.xml.rels');
  if (pres && relsFile) {
    const presDoc = parseXml(decodeXmlBytes(await pres.async('uint8array')));
    const rels = parseRels(decodeXmlBytes(await relsFile.async('uint8array')));
    if (presDoc) {
      const order: string[] = [];
      for (const sld of Array.from(presDoc.getElementsByTagNameNS(NS_P, 'sldId'))) {
        const rid = sld.getAttributeNS(NS_R, 'id') || sld.getAttribute('r:id') || '';
        const rel = rels.get(rid);
        if (!rel) continue;
        const path = normTarget('ppt/presentation.xml', rel.target);
        if (zip.file(path)) order.push(path);
      }
      if (order.length) return order;
    }
  }
  return Object.keys(zip.files)
    .filter((p: string) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a: string, b: string) => {
      const n = (s: string) => Number(s.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return n(a) - n(b);
    });
}

async function parsePptx(file: Blob, ext: string, warnings: string[]): Promise<ParsedDoc> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const order = await slideOrder(zip);

  const slides: SlideData[] = [];
  /** 图片字节预算：超出后不再内联，避免素材库膨胀 */
  const MAX_TOTAL_IMAGE = 6 * 1024 * 1024;
  let imageBytes = 0;

  for (let i = 0; i < order.length; i++) {
    const path = order[i];
    const f = zip.file(path);
    if (!f) continue;
    let title: string | undefined;
    let bullets: string[] = [];
    let paragraphs = 0;
    try {
      const parsed = parseSlideXml(decodeXmlBytes(await f.async('uint8array')));
      title = parsed.title;
      bullets = parsed.bullets;
      paragraphs = parsed.paragraphs;
    } catch {
      warnings.push(`第 ${i + 1} 页解析失败，已跳过文字`);
    }

    // 图片与备注都通过 rels 关联，不能按 slideN 猜 notesSlideN
    const relPath = path.replace('slides/', 'slides/_rels/') + '.rels';
    const relFile = zip.file(relPath);
    const rels: Map<string, { target: string; type: string }> = relFile
      ? parseRels(decodeXmlBytes(await relFile.async('uint8array')))
      : new Map();

    const images: string[] = [];
    for (const rel of rels.values()) {
      if (!/\/image$/.test(rel.type)) continue;
      const imgPath = normTarget(path, rel.target);
      const imgFile = zip.file(imgPath);
      if (!imgFile) continue;
      const blob: Blob = await imgFile.async('blob');
      if (imageBytes + blob.size > MAX_TOTAL_IMAGE) continue;
      imageBytes += blob.size;
      const iext = imgPath.split('.').pop()?.toLowerCase() ?? 'png';
      const typed = new Blob([blob], { type: MIME_BY_EXT[iext] ?? 'image/png' });
      // 图片存进 IndexedDB，幻灯片只持有 key：
      // 否则整份 PPT 的 base64 会随素材列表一起常驻内存，几十页就吃掉上百 MB
      images.push(await putSlideImage(typed));
    }

    let notes: string | undefined;
    for (const rel of rels.values()) {
      if (!/\/notesSlide$/.test(rel.type)) continue;
      const noteFile = zip.file(normTarget(path, rel.target));
      if (!noteFile) break;
      const nd = parseXml(decodeXmlBytes(await noteFile.async('uint8array')));
      if (!nd) break;
      const txt = Array.from(nd.getElementsByTagNameNS(NS_A, 't'))
        .map((t) => t.textContent || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (txt) notes = txt;
      break;
    }

    if (title || bullets.length || images.length || paragraphs) {
      slides.push({ index: slides.length, title, bullets, notes, images });
    }
  }

  if (!slides.length) {
    throw new Error('没有从该文件中解析出任何幻灯片内容（可能全部为图片页）');
  }
  const text = slides
    .map((s) => [s.title, ...s.bullets].filter(Boolean).join('\n'))
    .join('\n\n')
    .trim();
  return { kind: 'slides', text, slides, ext, source: 'PowerPoint', encoding: 'OOXML', warnings };
}

/** 幻灯片图片在 IndexedDB 中的引用前缀 */
export const SLIDE_IMG_PREFIX = 'img:';

/**
 * 幻灯片图片落盘（IndexedDB），返回引用 key。
 * 直接把 base64 放进幻灯片数据，会让整份 PPT 的图片随素材列表常驻内存。
 */
export async function putSlideImage(blob: Blob): Promise<string> {
  const key = await putAudio(blob, `img-${uid()}`);
  return SLIDE_IMG_PREFIX + key;
}

/** 兼容历史数据：仍以 data:/blob:/http 开头的幻灯片图片直接当 URL 用 */
export const isInlineImage = (src: string) => /^(data:|blob:|https?:)/i.test(src);

/* ------------------------------------------------------------------ */
/* 旧版 PowerPoint (.ppt / .pps) — OLE 复合文档 + 二进制记录            */
/* ------------------------------------------------------------------ */

interface CfbEntry {
  name: string;
  type: number;
  start: number;
  size: number;
}

/** 极简 CFB（OLE2）读取：只取根目录下的流，够读 PowerPoint Document */
function readCfb(bytes: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, Uint8Array>();
  if (bytes.length < 512) return out;
  if (dv.getUint32(0, true) !== 0xe011cfd0) return out;

  const sectorShift = dv.getUint16(30, true);
  const sectorSize = 1 << sectorShift;
  const miniShift = dv.getUint16(32, true);
  const miniSize = 1 << miniShift;
  const numFat = dv.getUint32(44, true);
  const dirStart = dv.getUint32(48, true);
  const miniCutoff = dv.getUint32(56, true);
  const miniFatStart = dv.getUint32(60, true);
  const difatStart = dv.getUint32(68, true);

  const sectorOffset = (s: number) => (s + 1) * sectorSize;
  const readSector = (s: number) => {
    const off = sectorOffset(s);
    return bytes.subarray(off, Math.min(bytes.length, off + sectorSize));
  };

  // DIFAT → FAT 扇区列表
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = dv.getUint32(76 + i * 4, true);
    if (s === 0xffffffff) break;
    fatSectors.push(s);
  }
  let difat = difatStart;
  for (let guard = 0; guard < 1000 && difat !== 0xfffffffe && difat !== 0xffffffff; guard++) {
    const sec = readSector(difat);
    const sdv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
    const per = sectorSize / 4 - 1;
    for (let i = 0; i < per; i++) {
      const s = sdv.getUint32(i * 4, true);
      if (s !== 0xffffffff) fatSectors.push(s);
    }
    difat = sdv.getUint32(per * 4, true);
  }
  if (fatSectors.length < numFat && fatSectors.length === 0) return out;
  if (fatSectors.length > Math.ceil(bytes.length / sectorSize) + 8) {
    fatSectors.length = Math.ceil(bytes.length / sectorSize) + 8;
  }

  const fat: number[] = [];
  for (const s of fatSectors) {
    const sec = readSector(s);
    const sdv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(sdv.getUint32(i * 4, true));
  }

  // 扇区链最长不可能超过文件总扇区数——损坏的 FAT 会造成"环"，必须有硬上限
  const maxChain = Math.ceil(bytes.length / sectorSize) + 8;
  const chain = (start: number): number[] => {
    const list: number[] = [];
    let cur = start;
    for (let guard = 0; guard < maxChain; guard++) {
      if (cur === 0xfffffffe || cur === 0xffffffff || cur >= fat.length) break;
      list.push(cur);
      cur = fat[cur];
    }
    return list;
  };
  const readChain = (start: number, size: number): Uint8Array => {
    const secs = chain(start);
    const buf = new Uint8Array(secs.length * sectorSize);
    secs.forEach((s, i) => {
      const sec = readSector(s);
      buf.set(sec.subarray(0, Math.min(sec.length, sectorSize)), i * sectorSize);
    });
    return buf.subarray(0, Math.min(size || buf.length, buf.length));
  };

  // 目录
  const dirBytes = readChain(dirStart, 0);
  const entries: CfbEntry[] = [];
  const ddv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
    const nameLen = ddv.getUint16(off + 64, true);
    if (!nameLen) continue;
    let name = '';
    for (let i = 0; i < Math.max(0, nameLen / 2 - 1); i++) {
      name += String.fromCharCode(ddv.getUint16(off + i * 2, true));
    }
    entries.push({
      name,
      type: ddv.getUint8(off + 66),
      start: ddv.getUint32(off + 116, true),
      size: ddv.getUint32(off + 120, true),
    });
  }
  if (!entries.length) return out;

  // 迷你流（小于 4096 字节的对象）
  const root = entries[0];
  const miniStream = root ? readChain(root.start, root.size) : new Uint8Array();
  const miniFatBytes = miniFatStart === 0xfffffffe ? new Uint8Array() : readChain(miniFatStart, 0);
  const miniFat = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
  const readMini = (start: number, size: number): Uint8Array => {
    const chunks: Uint8Array[] = [];
    const maxMini = Math.ceil(miniStream.length / miniSize) + 8;
    let cur = start;
    for (let guard = 0; guard < maxMini; guard++) {
      if (cur === 0xfffffffe || cur === 0xffffffff) break;
      const off = cur * miniSize;
      if (off >= miniStream.length) break;
      chunks.push(miniStream.subarray(off, Math.min(miniStream.length, off + miniSize)));
      if (cur * 4 + 4 > miniFatBytes.length) break;
      cur = miniFat.getUint32(cur * 4, true);
    }
    if (!chunks.length) return new Uint8Array();
    const buf = new Uint8Array(chunks.length * miniSize);
    chunks.forEach((c, i) => buf.set(c, i * miniSize));
    return buf.subarray(0, Math.min(size, buf.length));
  };

  for (const e of entries) {
    if (e.type !== 2 || !e.name || e.name === 'Root Entry') continue;
    const data = e.size < miniCutoff ? readMini(e.start, e.size) : readChain(e.start, e.size);
    if (data.length) out.set(e.name, data);
  }
  return out;
}

const RT_TEXT_CHARS = 4000;
const RT_TEXT_BYTES = 4008;
const RT_SLIDE_LIST = 4080;
const RT_SLIDE_PERSIST = 1011;
/* [MS-PPT] 记录类型：1006 = Slide，1008 = Notes，1016 = MainMaster */
const RT_SLIDE = 1006;
const RT_NOTES = 1008;
const RT_MASTER = 1016;

interface PptPage {
  title?: string;
  bullets: string[];
}

/** 可能是「容器型」记录（payload 里还嵌套记录）的类型白名单 */
const RECORD_LIKE = new Set<number>([
  3999, 4000, 4001, 4008, 4010, 4033, 4080, 1000, 1006, 1007, 1008, 1009, 1010, 1011, 1033, 1036,
  0xf000, 0xf001, 0xf002, 0xf003, 0xf004, 0xf005, 0xf00d, 0xf118, 0xf119, 0xf11a, 0xf11c, 0xf121,
]);

/**
 * 解析 PowerPoint Document 流中的文字。
 *
 * PPT 二进制里文字有两个来源：
 * 1) SlideListWithText（按页顺序，但不含后加文本框）；
 * 2) 每页 Slide 容器 → Pictures → OfficeArt → ClientTextbox 内的记录。
 * 优先用第 2 种（分页更准、能覆盖文本框），失败再退回第 1 种。
 */
function pptRecordsToSlides(stream: Uint8Array, warnings: string[]): { slides: SlideData[]; paragraphs: string[] } {
  const dv = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const allParas: string[] = [];

  const textOfAtom = (pos: number, len: number, type: number): string => {
    const body = stream.subarray(pos, Math.min(stream.length, pos + len));
    let s = '';
    if (type === RT_TEXT_CHARS) {
      for (let i = 0; i + 1 < body.length; i += 2) s += String.fromCharCode(body[i] | (body[i + 1] << 8));
    } else {
      // TextBytesAtom：单字节，通常是 cp1252 / latin1
      for (let i = 0; i < body.length; i++) s += String.fromCharCode(body[i]);
    }
    return s;
  };

  const splitParas = (t: string) =>
    t
      .replace(/\r/g, '\n')
      .replace(/\u000b/g, '\n')
      .split('\n')
      .map((x) => x.replace(/[\u0000-\u0008\u000e-\u001f]/g, '').trim())
      .filter(Boolean);

  /** payload 是否像一组合法记录（用于钻入 ClientTextbox 等原子） */
  const looksLikeRecords = (b: number, e: number): boolean => {
    if (b + 8 > e) return false;
    const rt = dv.getUint16(b + 2, true);
    const rl = dv.getUint32(b + 4, true);
    return RECORD_LIKE.has(rt) && rl > 0 && b + 8 + rl <= e;
  };

  /* ---- 模式一：按 Slide 容器分页 ---- */
  const slides: SlideData[] = [];
  const seenText = new Set<string>();
  let cur: PptPage | null = null;
  let visits = 0;

  const addParas = (paras: string[]) => {
    allParas.push(...paras);
    if (!cur) cur = { bullets: [] };
    for (const p of paras) {
      const key = p.replace(/\s/g, '');
      if (!key || seenText.has(key)) continue;
      seenText.add(key);
      // 每页首个短段落视为标题
      if (!cur.title && !cur.bullets.length && p.length <= 80) cur.title = p;
      else cur.bullets.push(p);
    }
  };
  const flush = () => {
    if (cur && (cur.title || cur.bullets.length)) slides.push({ index: slides.length, ...cur, images: [] });
    cur = null;
  };

  const walk = (start: number, end: number, depth: number) => {
    if (depth > 24) return;
    let pos = start;
    while (pos + 8 <= end) {
      if (++visits > 300000) return; // 防御损坏文件造成的超长遍历
      const vi = dv.getUint16(pos, true);
      const rt = dv.getUint16(pos + 2, true);
      const rl = dv.getUint32(pos + 4, true);
      const body = pos + 8;
      const next = body + rl;
      if (rl > end - body || next > end) break; // 记录损坏，停止本层
      const ver = vi & 0x0f;

      if (ver === 0x0f) {
        if (rt === RT_SLIDE) {
          flush();
          cur = { bullets: [] };
          walk(body, next, depth + 1);
          flush();
        } else if (rt === RT_MASTER || rt === RT_NOTES) {
          // 母版/备注的文字会与正文重复，跳过
        } else if (rt === RT_SLIDE_LIST) {
          // 模式二才用，这里跳过，避免与 Slide 容器重复
        } else {
          walk(body, next, depth + 1);
        }
      } else if (rt === RT_TEXT_CHARS || rt === RT_TEXT_BYTES) {
        addParas(splitParas(textOfAtom(body, rl, rt)));
      } else if (rl > 8 && looksLikeRecords(body, next)) {
        // ClientTextbox 等原子内部还嵌着记录
        walk(body, next, depth + 1);
      }
      pos = next;
    }
  };

  try {
    walk(0, stream.length, 0);
  } catch (e: any) {
    warnings.push(`二进制记录解析中断：${e?.message || e}`);
  }

  /* ---- 模式二：退回 SlideListWithText（instance 0 = 幻灯片文字） ---- */
  if (!slides.length) {
    const listSlides: SlideData[] = [];
    const walkList = (start: number, end: number, depth: number) => {
      if (depth > 12) return;
      let pos = start;
      while (pos + 8 <= end) {
        const vi = dv.getUint16(pos, true);
        const rt = dv.getUint16(pos + 2, true);
        const rl = dv.getUint32(pos + 4, true);
        const body = pos + 8;
        const next = body + rl;
        if (rl > end - body || next > end) break;
        if ((vi & 0x0f) === 0x0f) {
          if (rt === RT_SLIDE_LIST && (vi >> 4) === 0) {
            // 逐个子记录：SlidePersistAtom 开新页
            let p2 = body;
            let lp: PptPage | null = null;
            while (p2 + 8 <= next) {
              const t = dv.getUint16(p2 + 2, true);
              const l = dv.getUint32(p2 + 4, true);
              const ab = p2 + 8;
              if (ab + l > next) break;
              if (t === RT_SLIDE_PERSIST) {
                if (lp && (lp.title || lp.bullets.length)) listSlides.push({ index: listSlides.length, ...lp, images: [] });
                lp = { bullets: [] };
              } else if (t === RT_TEXT_CHARS || t === RT_TEXT_BYTES) {
                for (const para of splitParas(textOfAtom(ab, l, t))) {
                  if (!lp) lp = { bullets: [] };
                  if (!lp.title && !lp.bullets.length && para.length <= 80) lp.title = para;
                  else lp.bullets.push(para);
                }
              }
              p2 = ab + l;
            }
            if (lp && (lp.title || lp.bullets.length)) listSlides.push({ index: listSlides.length, ...lp, images: [] });
          } else {
            walkList(body, next, depth + 1);
          }
        }
        pos = next;
      }
    };
    try {
      walkList(0, stream.length, 0);
    } catch {
      /* 忽略 */
    }
    if (listSlides.length) {
      warnings.push('已按旧版 .ppt 的幻灯片文字列表还原分页');
      return { slides: dedupeSlides(listSlides), paragraphs: allParas };
    }
    if (allParas.length) {
      // 完全无法分页：按连续文稿返回
      return { slides: [], paragraphs: allParas };
    }
    return { slides: [], paragraphs: allParas };
  }

  return { slides: dedupeSlides(slides), paragraphs: allParas };
}

/** 去掉内容重复的页面（母版/占位符常被记录两次） */
function dedupeSlides(list: SlideData[]): SlideData[] {
  const seen = new Set<string>();
  const out: SlideData[] = [];
  for (const s of list) {
    const key = `${s.title || ''}|${s.bullets.join('')}`;
    if (!key.replace(/\|/g, '') || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...s, index: out.length });
  }
  return out;
}

async function parsePpt(file: Blob, ext: string, warnings: string[]): Promise<ParsedDoc> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const streams = readCfb(bytes);
  const doc =
    streams.get('PowerPoint Document') ||
    streams.get('PP40') ||
    [...streams.entries()].find(([k]) => /powerpoint/i.test(k))?.[1];
  if (!doc) throw new Error('不是有效的 PowerPoint 97-2003 文件（未找到 PowerPoint Document 流）');

  const parsed = pptRecordsToSlides(doc, warnings);
  const slides = parsed.slides;

  if (!slides.length) {
    // 没有分页信息时退化为纯文稿
    const fallback = parsed.paragraphs;
    if (!fallback.length) throw new Error('未能在该 .ppt 中提取到文字（可能是纯图片版式）');
    warnings.push('旧版 .ppt 未能解析分页，已按连续文稿呈现');
    const blocks = fallback.map((text) => ({ type: 'para' as const, text }));
    return { kind: 'text', text: fallback.join('\n'), blocks, ext, source: 'PowerPoint 97-2003', warnings };
  }

  const text = slides
    .map((s) => [s.title, ...s.bullets].filter(Boolean).join('\n'))
    .join('\n\n')
    .trim();
  return { kind: 'slides', text, slides, ext, source: 'PowerPoint 97-2003', warnings };
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

let pdfjsReady: Promise<any> | null = null;

/** 按需加载 pdf.js（legacy 构建，兼容更老的浏览器） */
async function loadPdfjs() {
  if (!pdfjsReady) {
    pdfjsReady = (async () => {
      const lib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const worker: any = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })();
  }
  return pdfjsReady;
}

/** 把 pdf.js 的文本片段按行聚合成段落 */
function pdfItemsToLines(items: any[]): string[] {
  type Row = { y: number; parts: { x: number; s: string }[] };
  const rows: Row[] = [];
  for (const it of items) {
    const s: string = it.str ?? '';
    if (!s.trim()) continue;
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    const x = tr[4];
    const y = Math.round(tr[5]);
    let row = rows.find((r) => Math.abs(r.y - y) <= 3);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, s });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((r) =>
      r.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.s)
        .join('')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

async function parsePdf(file: Blob, warnings: string[]): Promise<ParsedDoc> {
  const lib = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const base = (import.meta.env.BASE_URL || './').replace(/\/$/, '');
  const task = lib.getDocument({
    data,
    cMapUrl: `${base}/pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}/pdfjs/standard_fonts/`,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  const slides: SlideData[] = [];
  let emptyPages = 0;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    let lines: string[] = [];
    try {
      const content = await page.getTextContent();
      lines = pdfItemsToLines(content.items || []);
    } catch {
      emptyPages++;
    }
    const [first, ...rest] = lines;
    const title = first && first.length <= 120 ? first : undefined;
    const bullets = title ? rest : lines;
    if (!lines.length) emptyPages++;
    slides.push({ index: slides.length, page: p, title, bullets, images: [] });
    page.cleanup?.();
  }
  await pdf.destroy?.();

  if (emptyPages === slides.length) {
    throw new Error(
      '这份 PDF 没有可提取的文字（可能是扫描件或纯图片版式）。建议先用 OCR 转成文字稿，或改用 PPT / Word 稿件。',
    );
  }
  if (emptyPages) warnings.push(`${emptyPages} 页没有可提取文字（可能是图片页）`);

  const text = slides
    .map((s) => [s.title, ...s.bullets].filter(Boolean).join('\n'))
    .join('\n\n')
    .trim();
  return { kind: 'slides', text, slides, ext: 'pdf', source: 'PDF', encoding: 'PDF', warnings };
}

/* ------------------------------------------------------------------ */
/* OpenDocument Presentation (.odp)                                    */
/* ------------------------------------------------------------------ */

async function parseOdp(file: Blob, warnings: string[]): Promise<ParsedDoc> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const content = zip.file('content.xml');
  if (!content) throw new Error('不是有效的 .odp 文件（缺少 content.xml）');
  const xml = decodeXmlBytes(await content.async('uint8array'));
  const doc = parseXml(xml);
  if (!doc) throw new Error('.odp 内容解析失败');

  const slides: SlideData[] = [];
  const pages = Array.from(doc.getElementsByTagName('draw:page'));
  for (const page of pages) {
    const lines: string[] = [];
    for (const p of Array.from(page.getElementsByTagName('text:p'))) {
      const t = (p.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) lines.push(t);
    }
    const [first, ...rest] = lines;
    slides.push({
      index: slides.length,
      title: first && first.length <= 120 ? first : undefined,
      bullets: first && first.length <= 120 ? rest : lines,
      images: [],
    });
  }
  if (!slides.length) throw new Error('该 .odp 中没有可读文本');
  if (!pages.length) warnings.push('未检测到分页信息');
  const text = slides
    .map((s) => [s.title, ...s.bullets].filter(Boolean).join('\n'))
    .join('\n\n')
    .trim();
  return { kind: 'slides', text, slides, ext: 'odp', source: 'OpenDocument', encoding: 'ODF', warnings };
}

/* ------------------------------------------------------------------ */
/* RTF                                                                 */
/* ------------------------------------------------------------------ */

/** RTF 转纯文本：剥离控制字与字体表，保留段落 */
function rtfToText(rtf: string): string {
  let s = rtf.replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(((Number(n) % 65536) + 65536) % 65536));
  s = s.replace(/\{\\\*[^{}]*\}/g, '');
  s = s.replace(/\\par[d]?/g, '\n').replace(/\\line/g, '\n').replace(/\\tab/g, '\t');
  s = s.replace(/\\[a-z]+-?\d*\s?/gi, '');
  s = s.replace(/[{}]/g, '');
  return clean(s);
}

async function parseRtf(file: Blob, warnings: string[]): Promise<ParsedDoc> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const raw = decodeXmlBytes(buf);
  const text = rtfToText(raw);
  if (!text.trim()) throw new Error('该 RTF 中没有可读文本');
  const blocks = textToBlocks(text);
  warnings.push('RTF 仅提取正文文字，复杂格式会简化');
  return { kind: 'text', text: blocks.map((b) => b.text).join('\n'), blocks, ext: 'rtf', source: 'RTF', warnings };
}

/* ------------------------------------------------------------------ */
/* 统一入口                                                            */
/* ------------------------------------------------------------------ */

/** 幻灯片类（分页呈现）：PPT 全家族 + PDF + ODP + Keynote 导出 */
export const SLIDE_ACCEPT = '.pptx,.pptm,.ppsx,.potx,.ppt,.pps,.pdf,.odp';
export const PPT_ACCEPT = '.pptx,.pptm,.ppsx,.potx,.ppt,.pps';
/** 稿件类（连续文稿）：Word / 文本 / 字幕 */
export const SCRIPT_ACCEPT = '.txt,.md,.markdown,.srt,.vtt,.ass,.ssa,.docx,.xml,.rtf,.json,.csv';
/** 兼容旧调用：任意稿件 */
export const DOC_ACCEPT = `${PPT_ACCEPT},${SCRIPT_ACCEPT},.pdf,.odp`;

const SLIDE_RE = /\.(pptx|pptm|ppsx|potx|ppt|pps|pdf|odp)$/i;
const SCRIPT_RE = /\.(txt|md|markdown|srt|vtt|ass|ssa|docx|xml|rtf|json|csv|text)$/i;

export const isPptxFile = (n: string) => /\.(pptx|pptm|ppsx|potx)$/i.test(n);
export const isPptFile = (n: string) => /\.(ppt|pps)$/i.test(n);
export const isPdfFile = (n: string) => /\.pdf$/i.test(n);
export const isOdpFile = (n: string) => /\.odp$/i.test(n);
export const isDocxFile = (n: string) => /\.docx$/i.test(n);
export const isDocFile = (n: string) => /\.doc$/i.test(n);
export const isRtfFile = (n: string) => /\.rtf$/i.test(n);
export const isWordXmlFile = (n: string) => /\.xml$/i.test(n);
export const isSubtitleFile = (n: string) => /\.(srt|vtt|ass|ssa)$/i.test(n);
export const isPlainTextFile = (n: string) => /\.(txt|md|markdown|text|json|csv)$/i.test(n);

/** 是否属于「幻灯片类」文件（决定走哪个上传入口） */
export const isSlideDoc = (name: string) => SLIDE_RE.test(name);
/** 是否属于「稿件类」文件 */
export const isScriptDoc = (name: string) => SCRIPT_RE.test(name);

/** 旧版二进制格式提示（浏览器无法直接解析） */
export function legacyHint(name: string): string | null {
  if (isDocFile(name)) {
    return '旧版 .doc 是二进制格式，浏览器无法解析。请用 Word 另存为 .docx 后再导入（或在 Word 中复制文字直接粘贴）。';
  }
  return null;
}

/**
 * 解析任意稿件 / 幻灯片文件。
 * 二进制文件不会被当作文本读取——避免出现整页乱码。
 */
export async function parseScriptFile(file: File | Blob, name?: string): Promise<ParsedDoc> {
  const fileName = name || (file as File).name || '';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const warnings: string[] = [];

  const hint = legacyHint(fileName);
  if (hint) throw new Error(hint);

  if (isPptxFile(fileName)) return parsePptx(file, ext, warnings);
  if (isPptFile(fileName)) return parsePpt(file, ext, warnings);
  if (isPdfFile(fileName)) return parsePdf(file, warnings);
  if (isOdpFile(fileName)) return parseOdp(file, warnings);
  if (isDocxFile(fileName)) return parseDocx(file, warnings);
  if (isRtfFile(fileName)) return parseRtf(file, warnings);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (looksBinary(bytes)) {
    // 走到这里说明是未识别的二进制（如 .pages / .key / 加密文档）
    throw new Error(
      `「${fileName || '该文件'}」是二进制格式，浏览器无法解析。支持的格式：PPT/PPTX/PDF、Word(.docx)、TXT/MD/SRT/VTT、RTF。`,
    );
  }
  const text = decodeXmlBytes(bytes);
  if (isWordXmlFile(fileName) && /<\?mso-application|Word\.Document|w:wordDocument/i.test(text.slice(0, 2000))) {
    return parseWord2003Xml(file, warnings);
  }

  const { text: decoded, encoding } = await readTextAuto(new Blob([bytes]));
  const blocks = textToBlocks(decoded);
  if (!blocks.length) throw new Error('文件内容为空或不是可识别的文本');
  return {
    kind: 'text',
    text: blocks.map((b) => (b.type === 'li' ? `· ${b.text}` : b.text)).join('\n'),
    blocks,
    encoding,
    ext: ext || 'txt',
    source: '文本',
    warnings,
  };
}

/** 解析结果 → 统一纯文本（供对齐与术语提取） */
export function docToText(doc: ParsedDoc): string {
  return doc.text.replace(/\r/g, '').trim();
}
