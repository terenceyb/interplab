
import type { SlideData } from '@/types';
export type { SlideData };

/** 解析结果：文本稿 或 幻灯片 */
export interface ParsedDoc {
  kind: 'text' | 'slides';
  /** 纯文本（幻灯片则为各页文本拼接），用于对齐、术语提取 */
  text: string;
  slides?: SlideData[];
  /** 文本类文件检测到的编码 */
  encoding?: string;
  /** 原始扩展名 */
  ext: string;
}

/* ------------------------------------------------------------------ */
/* 编码识别                                                            */
/* ------------------------------------------------------------------ */

/** jschardet 结果 → TextDecoder 可用的 label */
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
  'BIG5': 'big5',
  Shift_JIS: 'shift_jis',
  'EUC-JP': 'euc-jp',
  'EUC-KR': 'euc-kr',
  UTF16: 'utf-16le',
  'UTF-16LE': 'utf-16le',
  'UTF-16BE': 'utf-16be',
  'KOI8-R': 'koi8-r',
  'windows-1251': 'windows-1251',
};

/** 替换字符占比过高说明解码方式不对 */
function badRatio(s: string): number {
  if (!s) return 0;
  let bad = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0xfffd || (c < 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x09)) bad++;
  }
  // 控制字符（除了换行制表）也算解码错误
  return bad / s.length;
}

function decodeWith(bytes: Uint8Array, label: string): string | null {
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * 读取纯文本文件并自动识别编码。
 * 顺序：BOM → UTF-8 严格校验 → jschardet 猜测 → GB18030 兜底。
 * 目标：中文 GBK/GB2312 文件不再乱码。
 */
export async function readTextAuto(file: Blob): Promise<{ text: string; encoding: string }> {
  const buf = new Uint8Array(await file.arrayBuffer());

  // 1) BOM
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: decodeWith(buf.subarray(3), 'utf-8') ?? '', encoding: 'UTF-8 (BOM)' };
  }
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: decodeWith(buf, 'utf-16le') ?? '', encoding: 'UTF-16LE (BOM)' };
  }
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: decodeWith(buf, 'utf-16be') ?? '', encoding: 'UTF-16BE (BOM)' };
  }

  // 2) 严格 UTF-8 校验（fatal 模式，非法序列会抛错）
  try {
    const strict = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { text: strict, encoding: 'UTF-8' };
  } catch {
    /* 不是合法 UTF-8，继续猜 */
  }

  // 3) jschardet 猜测
  let label = '';
  try {
    // 按需加载编码探测库（体积较大，只在导入文本时用）
    const { default: jschardet } = await import('jschardet');
    const det = jschardet.detect(buf as unknown as Buffer);
    if (det?.encoding) label = ENC_MAP[det.encoding] ?? '';
  } catch {
    /* ignore */
  }

  if (label) {
    const txt = decodeWith(buf, label);
    if (txt && badRatio(txt) < 0.01) return { text: txt, encoding: label.toUpperCase() };
  }

  // 4) 中文场景兜底：GB18030 覆盖 GBK/GB2312
  const gb = decodeWith(buf, 'gb18030');
  if (gb && badRatio(gb) < 0.01) return { text: gb, encoding: 'GB18030' };

  // 5) 最后退回 UTF-8（容错模式）
  return { text: decodeWith(buf, 'utf-8') ?? '', encoding: 'UTF-8 (强制)' };
}

/* ------------------------------------------------------------------ */
/* Word (.docx)                                                        */
/* ------------------------------------------------------------------ */

async function parseDocx(file: Blob): Promise<ParsedDoc> {
  // 按需加载：只有真正导入 Word 时才拉取解析器，避免拖慢首屏
  const mammoth = (await import('mammoth/mammoth.browser.js')).default;
  const arrayBuffer = await file.arrayBuffer();
  // mammoth 浏览器版：提取纯文本并保留段落
  const res = await mammoth.extractRawText({ arrayBuffer });
  const text = (res.value || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { kind: 'text', text, ext: 'docx', encoding: 'OOXML' };
}

/* ------------------------------------------------------------------ */
/* PowerPoint (.pptx)                                                  */
/* ------------------------------------------------------------------ */

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** 从 slide xml 中取出标题、正文段落、备注 */
function parseSlideXml(xml: string): { title?: string; bullets: string[] } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  let title: string | undefined;
  const bullets: string[] = [];

  const shapes = Array.from(doc.getElementsByTagNameNS(NS_P, 'sp'));
  for (const sp of shapes) {
    // 判断占位符类型
    const ph = sp.getElementsByTagNameNS(NS_P, 'ph')[0];
    const phType = ph?.getAttribute('type') ?? '';
    const isTitle = phType === 'title' || phType === 'ctrTitle';

    // 每个段落（a:p）内的所有文本（a:t）拼起来
    const paras = Array.from(sp.getElementsByTagNameNS(NS_A, 'p'));
    for (const p of paras) {
      const txt = Array.from(p.getElementsByTagNameNS(NS_A, 't'))
        .map((t) => t.textContent ?? '')
        .join('')
        .trim();
      if (!txt) continue;
      if (isTitle && !title) title = txt;
      else bullets.push(txt);
    }
  }
  return { title, bullets };
}

/** 从 slide rels 找出该页引用的图片文件名 */
function imageTargetsFromRels(relsXml: string): string[] {
  const doc = new DOMParser().parseFromString(relsXml, 'application/xml');
  const out: string[] = [];
  for (const rel of Array.from(doc.getElementsByTagName('Relationship'))) {
    const type = rel.getAttribute('Type') ?? '';
    if (!/\/image$/.test(type)) continue;
    const target = rel.getAttribute('Target') ?? '';
    // 形如 ../media/image1.png → ppt/media/image1.png
    const clean = target.replace(/^\.\.\//, 'ppt/').replace(/^\/?ppt\//, 'ppt/');
    if (clean) out.push(clean);
  }
  return out;
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/** 解析 .pptx：按幻灯片顺序输出文本与图片 */
async function parsePptx(file: Blob): Promise<ParsedDoc> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  // 幻灯片顺序以 presentation.xml 的 sldIdLst 为准，缺失则按文件名数字排序
  let order: string[] = [];
  const presFile = zip.file('ppt/presentation.xml');
  const presRels = zip.file('ppt/_rels/presentation.xml.rels');
  if (presFile && presRels) {
    try {
      const presDoc = new DOMParser().parseFromString(await presFile.async('string'), 'application/xml');
      const relsDoc = new DOMParser().parseFromString(await presRels.async('string'), 'application/xml');
      const relMap = new Map<string, string>();
      for (const rel of Array.from(relsDoc.getElementsByTagName('Relationship'))) {
        relMap.set(rel.getAttribute('Id') ?? '', rel.getAttribute('Target') ?? '');
      }
      for (const sld of Array.from(presDoc.getElementsByTagNameNS(NS_P, 'sldId'))) {
        const rid = sld.getAttributeNS(NS_R, 'id') || sld.getAttribute('r:id') || '';
        const target = relMap.get(rid) ?? '';
        const m = target.match(/slides\/(slide\d+\.xml)$/);
        if (m) order.push(`ppt/slides/${m[1]}`);
      }
    } catch {
      /* 回退到文件名排序 */
    }
  }
  if (!order.length) {
    order = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => {
        const n = (s: string) => Number(s.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
        return n(a) - n(b);
      });
  }

  const slides: SlideData[] = [];
  let totalImageBytes = 0;
  const MAX_TOTAL_IMAGE = 12 * 1024 * 1024; // 12MB 上限，避免素材库膨胀

  for (let i = 0; i < order.length; i++) {
    const path = order[i];
    const f = zip.file(path);
    if (!f) continue;
    let title: string | undefined;
    let bullets: string[] = [];
    try {
      const parsed = parseSlideXml(await f.async('string'));
      title = parsed.title;
      bullets = parsed.bullets;
    } catch {
      /* 单页损坏不影响其他页 */
    }

    // 图片
    const images: string[] = [];
    const relPath = path.replace('slides/', 'slides/_rels/') + '.rels';
    const rf = zip.file(relPath);
    if (rf) {
      try {
        for (const imgPath of imageTargetsFromRels(await rf.async('string'))) {
          const imgFile = zip.file(imgPath);
          if (!imgFile) continue;
          const blob = await imgFile.async('blob');
          if (totalImageBytes + blob.size > MAX_TOTAL_IMAGE) continue;
          totalImageBytes += blob.size;
          const ext = imgPath.split('.').pop()?.toLowerCase() ?? 'png';
          const typed = new Blob([blob], { type: MIME_BY_EXT[ext] ?? 'image/png' });
          images.push(await blobToDataUrl(typed));
        }
      } catch {
        /* 图片失败不影响文本 */
      }
    }

    // 备注
    let notes: string | undefined;
    const notePath = `ppt/notesSlides/notesSlide${i + 1}.xml`;
    const nf = zip.file(notePath);
    if (nf) {
      try {
        const nd = new DOMParser().parseFromString(await nf.async('string'), 'application/xml');
        const txt = Array.from(nd.getElementsByTagNameNS(NS_A, 't'))
          .map((t) => t.textContent ?? '')
          .join(' ')
          .trim();
        if (txt) notes = txt;
      } catch {
        /* ignore */
      }
    }

    if (title || bullets.length || images.length) {
      slides.push({ index: slides.length, title, bullets, notes, images });
    }
  }

  const text = slides
    .map((s) => [s.title, ...s.bullets].filter(Boolean).join('\n'))
    .join('\n')
    .trim();

  return { kind: 'slides', text, slides, ext: 'pptx', encoding: 'OOXML' };
}

/* ------------------------------------------------------------------ */
/* 统一入口                                                            */
/* ------------------------------------------------------------------ */

const TEXT_EXT = /\.(txt|md|markdown|srt|vtt|ass|ssa|lrc|json|csv|text)$/i;

export const isDocxFile = (name: string) => /\.docx$/i.test(name);
export const isDocFile = (name: string) => /\.doc$/i.test(name);
export const isPptxFile = (name: string) => /\.pptx$/i.test(name);
export const isPptFile = (name: string) => /\.ppt$/i.test(name);
export const isSubtitleFile = (name: string) => /\.(srt|vtt|ass|ssa)$/i.test(name);
export const isPlainTextFile = (name: string) => TEXT_EXT.test(name);

/** 稿件类文件的总接受范围 */
export const SCRIPT_ACCEPT = '.txt,.md,.markdown,.srt,.vtt,.ass,.ssa,.docx,.pptx,.json,.csv';

/** 旧版 .doc / .ppt 为二进制格式，浏览器无法解析 */
export function legacyHint(name: string): string | null {
  if (isDocFile(name)) return '旧版 .doc 为二进制格式，浏览器无法解析，请用 Word 另存为 .docx 后重试';
  if (isPptFile(name)) return '旧版 .ppt 为二进制格式，浏览器无法解析，请用 PowerPoint 另存为 .pptx 后重试';
  return null;
}

export async function parseScriptFile(file: File): Promise<ParsedDoc> {
  const hint = legacyHint(file.name);
  if (hint) throw new Error(hint);

  if (isDocxFile(file.name)) return parseDocx(file);
  if (isPptxFile(file.name)) return parsePptx(file);

  if (isPlainTextFile(file.name) || file.type.startsWith('text/')) {
    const { text, encoding } = await readTextAuto(file);
    return { kind: 'text', text: text.replace(/\r/g, '').trim(), encoding, ext: file.name.split('.').pop()?.toLowerCase() ?? 'txt' };
  }

  // 未知类型：当作文本尽力解析
  const { text, encoding } = await readTextAuto(file);
  if (!text.trim()) throw new Error('文件内容为空或不是可识别的文本');
  return { kind: 'text', text: text.replace(/\r/g, '').trim(), encoding, ext: 'txt' };
}
