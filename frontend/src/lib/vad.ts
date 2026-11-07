import type { Segment, SegmentParams } from '@/types';

export interface VoiceActivity {
  /** 静音间隙（秒） */
  gaps: { start: number; end: number; len: number; mid: number }[];
  /** 语音段 */
  voices: { start: number; end: number }[];
  /** 总发声时长 */
  voiced: number;
  duration: number;
}

/**
 * VAD：短时能量 + 自适应阈值 + 最小静音/语音持续时间平滑
 */
export function analyzeVoiceActivity(buffer: AudioBuffer, opts?: { minPause?: number }): VoiceActivity {
  const minPause = opts?.minPause ?? 0.18;
  const ch = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const frame = Math.max(64, Math.floor(sr * 0.02));
  const hop = Math.max(32, Math.floor(sr * 0.01));
  const frames: number[] = [];
  for (let i = 0; i + frame < ch.length; i += hop) {
    let s = 0;
    for (let j = 0; j < frame; j += 4) {
      const v = ch[i + j];
      s += v * v;
    }
    frames.push(Math.sqrt(s / (frame / 4)));
  }
  const sorted = [...frames].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
  const floor = q(0.2);
  const peak = q(0.95);
  const thresh = Math.max(floor * 2.2, floor + (peak - floor) * 0.16, 1e-4);

  const raw = frames.map((v) => v > thresh);
  // 平滑：语音段需持续 60ms，静音需持续 minPause
  const minVoiceFrames = Math.max(1, Math.floor((sr * 0.06) / hop));
  const minSilFrames = Math.max(1, Math.floor((sr * minPause) / hop));
  const sm = smoothBinary(raw, minVoiceFrames, minSilFrames);

  const voices: { start: number; end: number }[] = [];
  const gaps: { start: number; end: number; len: number; mid: number }[] = [];
  let i = 0;
  let voiced = 0;
  while (i < sm.length) {
    const v = sm[i];
    let j = i;
    while (j < sm.length && sm[j] === v) j++;
    const start = (i * hop) / sr;
    const end = (j * hop) / sr;
    if (v) {
      voices.push({ start, end });
      voiced += end - start;
    } else if (i > 0 && j < sm.length) {
      const len = end - start;
      gaps.push({ start, end, len, mid: (start + end) / 2 });
    }
    i = j;
  }
  return { gaps, voices, voiced, duration: buffer.duration };
}

function smoothBinary(arr: boolean[], minTrue: number, minFalse: number): boolean[] {
  const out = arr.slice();
  let i = 0;
  while (i < out.length) {
    const v = out[i];
    let j = i;
    while (j < out.length && out[j] === v) j++;
    const len = j - i;
    const min = v ? minTrue : minFalse;
    if (len < min) {
      const prev = i > 0 ? out[i - 1] : !v;
      const next = j < out.length ? out[j] : prev;
      const fill = i === 0 ? next : prev;
      for (let k = i; k < j; k++) out[k] = fill;
    }
    i = j;
  }
  return out;
}

export interface SentenceHint {
  start: number;
  end: number;
  confidence: number;
}

/**
 * 智能分段：在「期望时长 ± 浮动范围」内寻找语义边界（静音间隙 + 可选稿件句边界）
 */
export function smartSegment(
  va: VoiceActivity,
  params: SegmentParams,
  hints: SentenceHint[] = [],
): Segment[] {
  const { target, floatPct, minSeg, maxSeg, preference } = params;
  const dur = va.duration;
  if (dur <= 0 || va.gaps.length === 0) {
    return [
      { index: 0, start: 0, end: dur, confidence: 0.3, approx: true },
    ];
  }
  const w =
    preference === 'punctuation'
      ? { pause: 0.2, punct: 0.55, prox: 0.25 }
      : preference === 'pause'
        ? { pause: 0.6, punct: 0.15, prox: 0.25 }
        : { pause: 0.35, punct: 0.35, prox: 0.3 };

  const scoreGap = (g: (typeof va.gaps)[number], targetAbs: number) => {
    const pauseScore = Math.min(1, g.len / 0.9);
    const punctScore = nearSentenceBoundary(g.mid, hints);
    const prox = 1 - Math.min(1, Math.abs(g.mid - targetAbs) / (target * floatPct));
    return pauseScore * w.pause + punctScore * w.punct + Math.max(0, prox) * w.prox;
  };

  const segments: Segment[] = [];
  let cursor = 0;
  let guard = 0;
  while (cursor < dur - 0.3 && guard++ < 2000) {
    const ideal = cursor + target;
    const lo = cursor + target * (1 - floatPct);
    const hi = cursor + target * (1 + floatPct);
    let inWindow = va.gaps.filter((g) => g.mid >= Math.max(lo, cursor + minSeg * 0.6) && g.mid <= Math.min(hi, cursor + maxSeg));
    let approx = false;
    let best: (typeof va.gaps)[number] | null = null;
    let bestScore = -1;
    if (inWindow.length) {
      for (const g of inWindow) {
        const s = scoreGap(g, ideal);
        if (s > bestScore) {
          bestScore = s;
          best = g;
        }
      }
    }
    if (!best) {
      // 浮动范围内无候选：向更远边界搜索，标记为近似切分
      approx = true;
      const far = va.gaps
        .filter((g) => g.mid > cursor + minSeg * 0.6 && g.mid <= cursor + maxSeg && Math.abs(g.mid - ideal) <= target * 0.8)
        .sort((a, b) => Math.abs(a.mid - ideal) - Math.abs(b.mid - ideal))[0];
      best = far || null;
      bestScore = far ? scoreGap(far, ideal) : 0;
    }
    if (!best) {
      // 剩余部分作为最后一段
      segments.push(makeSeg(segments.length, cursor, Math.min(dur, cursor + maxSeg), 0.35, true));
      cursor = Math.min(dur, cursor + maxSeg);
      continue;
    }
    const end = Math.min(dur, best.mid);
    const conf = Math.max(0.15, Math.min(1, bestScore)) * (approx ? 0.6 : 1);
    segments.push(makeSeg(segments.length, cursor, end, conf, approx));
    cursor = end;
  }
  if (segments.length === 0 || segments[segments.length - 1].end < dur - 0.3) {
    const last = segments[segments.length - 1];
    const start = last ? last.end : 0;
    segments.push(makeSeg(segments.length, start, dur, 0.4, true));
  }
  return mergeShort(segments, minSeg, maxSeg);
}

function makeSeg(index: number, start: number, end: number, confidence: number, approx: boolean): Segment {
  return { index, start, end, confidence, approx };
}

/** 合并过短段落 */
export function mergeShort(segments: Segment[], minSeg: number, maxSeg: number): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const prev = out[out.length - 1];
    if (prev && (s.end - s.start < minSeg || prev.end - prev.start < minSeg) && s.end - prev.start <= maxSeg) {
      prev.end = s.end;
      prev.confidence = Math.min(prev.confidence, s.confidence);
      prev.approx = prev.approx || s.approx;
    } else {
      out.push({ ...s });
    }
  }
  return out.map((s, i) => ({ ...s, index: i }));
}

/** 在指定位置拆分段落 */
export function splitSegment(segments: Segment[], index: number, at: number): Segment[] {
  const s = segments[index];
  if (!s || at <= s.start + 0.5 || at >= s.end - 0.5) return segments;
  const a = { ...s, end: at, confidence: Math.min(s.confidence, 0.6), approx: true };
  const b = { ...s, start: at, confidence: Math.min(s.confidence, 0.6), approx: true };
  const out = [...segments.slice(0, index), a, b, ...segments.slice(index + 1)];
  return out.map((x, i) => ({ ...x, index: i }));
}

export function mergeAt(segments: Segment[], index: number): Segment[] {
  const a = segments[index];
  const b = segments[index + 1];
  if (!a || !b) return segments;
  const merged: Segment = {
    index: a.index,
    start: a.start,
    end: b.end,
    confidence: Math.min(a.confidence, b.confidence),
    approx: a.approx || b.approx,
    text: [a.text, b.text].filter(Boolean).join(' '),
  };
  const out = [...segments.slice(0, index), merged, ...segments.slice(index + 2)];
  return out.map((x, i) => ({ ...x, index: i }));
}

function nearSentenceBoundary(t: number, hints: SentenceHint[]): number {
  let best = 0;
  for (const h of hints) {
    if (h.confidence < 0.4) continue;
    const dStart = Math.abs(t - h.end);
    const dEnd = Math.abs(t - h.start);
    const d = Math.min(dStart, dEnd);
    if (d < 0.8) best = Math.max(best, 1 - d / 0.8);
  }
  return best;
}

/** 按首尾裁剪区间裁剪 VAD 结果，并把时间轴平移为「以 trim.start 为 0」的虚拟时间 */
export function clipActivity(va: VoiceActivity, start: number, end: number): VoiceActivity {
  const off = start;
  const inRange = (a: number, b: number) => b > start && a < end;
  const clamp = (t: number) => Math.max(0, Math.min(end - start, t - off));
  const voices = va.voices
    .filter((v) => inRange(v.start, v.end))
    .map((v) => ({ start: clamp(v.start), end: clamp(v.end) }))
    .filter((v) => v.end > v.start);
  const gaps = va.gaps
    .filter((g) => inRange(g.start, g.end))
    .map((g) => {
      const s = clamp(g.start);
      const e = clamp(g.end);
      return { start: s, end: e, len: e - s, mid: (s + e) / 2 };
    })
    .filter((g) => g.len > 0.05);
  return {
    voices,
    gaps,
    voiced: voices.reduce((s, v) => s + (v.end - v.start), 0),
    duration: end - start,
  };
}

/** 估算语速：英文按词、中文按字 */
export function estimateRate(text: string, seconds: number): { wpm?: number; cpm?: number } {
  if (!text || seconds <= 0) return {};
  const en = (text.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
  const zh = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const minutes = seconds / 60;
  return { wpm: en ? Math.round(en / minutes) : undefined, cpm: zh ? Math.round(zh / minutes) : undefined };
}
