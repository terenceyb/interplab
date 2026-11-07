import type { Sentence } from '@/types';
import type { VoiceActivity } from './vad';

/** 句子切分：兼容中英标点 */
export function splitSentences(text: string): string[] {
  if (!text) return [];
  const raw = text
    .replace(/\r/g, '')
    .split(/(?<=[。！？!?；;])\s*|(?<=[.!?])\s+(?=[A-Z"'(\[])|\n{1,}/g)
    .map((s) => s.trim())
    .filter(Boolean);
  // 合并过短碎片（如“是的。”后紧跟的引文标记）
  const out: string[] = [];
  for (const s of raw) {
    if (out.length && s.length <= 2) out[out.length - 1] += s;
    else out.push(s);
  }
  return out;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

function toSeconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

/** 解析 SRT / VTT 字幕，返回带时间码的句子 */
export function parseSubtitle(text: string): SubtitleCue[] {
  const src = text.replace(/\r/g, '');
  const isVtt = /WEBVTT/i.test(src.slice(0, 40));
  const re = isVtt
    ? /(\d{2}):(\d{2}):(\d{2})\.(\d{1,3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{1,3})/g
    : /(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})/g;
  const cues: SubtitleCue[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const start = toSeconds(m[1], m[2], m[3], m[4]);
    const end = toSeconds(m[5], m[6], m[7], m[8]);
    const rest = src.slice(re.lastIndex);
    const lineEnd = rest.search(/\n\s*\n/);
    const body = (lineEnd >= 0 ? rest.slice(0, lineEnd) : rest)
      .split('\n')
      .slice(1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues;
}

export const hasTimecodes = (text: string) => /\d{2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(text);

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** 文本相似度：token 集合的 Dice 系数（对中英文都可用） */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  let hit = 0;
  for (const t of new Set(ta)) if (setB.has(t)) hit++;
  return (2 * hit) / (new Set(ta).size + setB.size);
}

export function tokens(s: string): string[] {
  const Seg = (Intl as any).Segmenter;
  if (Seg) {
    try {
      const seg = new Seg('zh', { granularity: 'word' });
      return Array.from(seg.segment(norm(s)))
        .map((x: any) => x.segment)
        .filter((w: string) => w.trim().length > 0 && !/^\s+$/.test(w));
    } catch {
      /* fallthrough */
    }
  }
  return norm(s).split(' ').filter(Boolean);
}

/**
 * 稿件与音频对齐：
 * - 有字幕时间码 → 直接映射（高置信）
 * - 仅纯文本 → 按字符权重在语音段上均匀分配（低-中置信，需手动校准）
 */
export function alignScript(
  scriptText: string,
  duration: number,
  va?: VoiceActivity,
  offset = 0,
): Sentence[] {
  const cues = hasTimecodes(scriptText) ? parseSubtitle(scriptText) : [];
  if (cues.length) {
    return cues.map((c, i) => ({
      id: `s${i}`,
      index: i,
      text: c.text,
      start: Math.max(0, c.start - offset),
      end: Math.max(0, c.end - offset),
      confidence: 0.95,
    }));
  }
  const sents = splitSentences(scriptText);
  if (!sents.length) return [];
  const weights = sents.map((s) => Math.max(1, s.replace(/\s/g, '').length));
  const total = weights.reduce((a, b) => a + b, 0);
  const voiced = va?.voiced && va.voiced > duration * 0.3 ? va.voiced : duration;
  const out: Sentence[] = [];
  let cursor = va?.voices?.[0]?.start ?? 0;
  sents.forEach((text, i) => {
    const len = (weights[i] / total) * voiced;
    out.push({
      id: `s${i}`,
      index: i,
      text,
      start: cursor,
      end: cursor + len,
      confidence: 0.35,
    });
    cursor += len;
  });
  // 若有 VAD，把句子起点吸附到最近的静音间隙中部，提升可用性
  if (va?.gaps?.length) {
    for (const s of out) {
      const near = va.gaps.reduce(
        (best, g) => (Math.abs(g.mid - s.start) < Math.abs(best.mid - s.start) ? g : best),
        va.gaps[0],
      );
      if (near && Math.abs(near.mid - s.start) < len0(out) * 0.6) {
        s.start = near.mid;
        s.confidence = 0.5;
      }
    }
    for (let i = 0; i < out.length - 1; i++) out[i].end = out[i + 1].start;
    out[out.length - 1].end = Math.min(duration, out[out.length - 1].end);
  }
  return out;
}

const len0 = (arr: Sentence[]) => (arr.length ? (arr[arr.length - 1].end - arr[0].start) / arr.length : 10);

/** 手动校准某句：以当前播放时间作为该句起点 */
export function calibrateSentence(list: Sentence[], index: number, start: number): Sentence[] {
  const out = list.map((s) => ({ ...s }));
  const s = out[index];
  if (!s) return out;
  const len = s.end - s.start;
  s.start = Math.max(0, start);
  s.end = s.start + len;
  s.confidence = 0.95;
  if (out[index - 1]) out[index - 1].end = s.start;
  if (out[index + 1] && out[index + 1].start < s.end) out[index + 1].start = s.end;
  return out;
}

/* ---------------- 术语候选与实体 ---------------- */

export type CandidateKind = 'number' | 'proper' | 'phrase' | 'glossary';

export interface TermCandidate {
  text: string;
  kind: CandidateKind;
  count: number;
}

const NUMBER_RE = /(?:\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s*(?:%|％|亿|万|万亿|million|billion|trillion|percent|km|kg|米|公里|美元|元|亿美金)?/gi;
const PROPER_RE = /\b[A-Z][A-Za-z0-9''-]*(?:\s+(?:of|and|for|de|the)\s+[A-Z][A-Za-z0-9''-]*|\s+[A-Z][A-Za-z0-9''-]*)*/g;

/** 从稿件中提取候选术语：数字表达、专有名词、英文名词短语 */
export function extractCandidates(text: string, glossary: string[] = []): TermCandidate[] {
  const map = new Map<string, TermCandidate>();
  const push = (t: string, kind: CandidateKind) => {
    const key = t.trim();
    if (!key || key.length < 2) return;
    const cur = map.get(key.toLowerCase());
    if (cur) cur.count++;
    else map.set(key.toLowerCase(), { text: key, kind, count: 1 });
  };
  for (const m of text.match(NUMBER_RE) || []) push(m.trim(), 'number');
  for (const m of text.match(PROPER_RE) || []) {
    const words = m.split(/\s+/);
    if (words.length >= 2 || (words.length === 1 && /[A-Z]/.test(m.slice(1)))) push(m.trim(), 'proper');
  }
  // 英文短语（2-4 词小写组合）
  for (const m of text.match(/\b[a-z][a-z'-]{2,}(?:\s+[a-z][a-z'-]{2,}){1,3}\b/gi) || []) {
    if (!/[A-Z]/.test(m)) push(m.trim(), 'phrase');
  }
  for (const g of glossary) {
    const re = new RegExp(escapeRe(g), 'gi');
    const hits = text.match(re);
    if (hits) push(g, 'glossary');
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** 覆盖率线索用的关键实体：数字 + 专有名词 */
export function extractEntities(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.match(NUMBER_RE) || []) out.add(m.trim());
  for (const m of text.match(PROPER_RE) || []) {
    if (m.split(/\s+/).length >= 1 && m.length >= 3) out.add(m.trim());
  }
  return [...out];
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ---------------- 文本遮挡 ---------------- */

export interface MaskPiece {
  text: string;
  masked: boolean;
}

/** 依据遮挡模式生成句子片段（用于带稿同传的遮挡训练） */
export function maskSentence(text: string, mode: 'none' | 'tail' | 'random', ratio = 0.2): MaskPiece[] {
  if (mode === 'none') return [{ text, masked: false }];
  const isZh = /[\u4e00-\u9fa5]/.test(text);
  const units = isZh
    ? Array.from(text.match(/[\u4e00-\u9fa5]|[^\s\u4e00-\u9fa5]+/g) || [text])
    : text.split(/(\s+)/);
  const idxs = units.map((_, i) => i).filter((i) => !isZh || /[\u4e00-\u9fa5]/.test(units[i]) || units[i].length > 1);
  let maskIdx = new Set<number>();
  if (mode === 'tail') {
    const n = Math.max(1, Math.round(idxs.length * (ratio || 0.2)));
    idxs.slice(-n).forEach((i) => maskIdx.add(i));
  } else {
    // 随机遮挡：以句子 id 为种子保证同一句每次渲染一致
    const seed = hashCode(text);
    for (const i of idxs) {
      if (pseudoRandom(seed + i) < ratio) maskIdx.add(i);
    }
    if (!maskIdx.size && idxs.length) maskIdx.add(idxs[idxs.length - 1]);
  }
  const out: MaskPiece[] = [];
  units.forEach((u, i) => {
    const masked = maskIdx.has(i);
    const last = out[out.length - 1];
    if (last && last.masked === masked) last.text += u;
    else out.push({ text: u, masked });
  });
  return out;
}

const hashCode = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};
const pseudoRandom = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

/** 在句子列表中查找当前时间对应的句子下标（二分） */
export function findSentenceIndex(list: Sentence[], t: number): number {
  let lo = 0;
  let hi = list.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (ans >= 0 && t > list[ans].end) return ans;
  return ans;
}
