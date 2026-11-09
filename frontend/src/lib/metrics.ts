import type { Attempt, FidelityClues, FluencyClues, CoverageClues, MetricsResult, Sentence } from '@/types';
import { estimateRate } from './vad';
import { extractEntities, similarity, splitSentences } from './text';

/**
 * 自动评估线索（**不是总分**）：
 * - 流利度来自录音能量包络的停顿统计
 * - 覆盖率/忠实度依赖源语文本与（可选）译语转写，缺失时明确标注不可用
 */

export interface MetricsInput {
  attempt: Attempt;
  /** 源语时间轴起点，用于把录音内时间映射回素材时间 */
  sourceStart: number;
  /** 源语文本（该段覆盖到的句子） */
  sourceText?: string;
  sentences?: Sentence[];
  glossary?: string[];
}

const PEAK_DENSITY = 40; // 与 audio.computePeaks 默认一致

export function computeMetrics(input: MetricsInput): MetricsResult {
  const { attempt, sourceStart, sourceText, glossary } = input;
  const fluency = computeFluency(attempt, sourceStart);
  const transcript = (attempt.transcript || '').trim();
  const coverage = computeCoverage(sourceText, transcript, glossary);
  const fidelity = computeFidelity(sourceText, transcript, input.sentences);
  return { fluency, coverage, fidelity, computedAt: Date.now() };
}

function computeFluency(attempt: Attempt, sourceStart: number): FluencyClues {
  const peaks = attempt.peaks || [];
  const dur = attempt.duration || 0;
  if (!peaks.length || dur <= 0) {
    return { pauseCount: 0, avgPause: 0, longestPause: null, phonationRatio: 0, longPausePositions: [] };
  }
  const sorted = [...peaks].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.2)] || 0;
  const peak = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const thresh = Math.max(floor * 1.6, peak * 0.12, 0.02);
  const dt = 1 / PEAK_DENSITY;
  const voiced: boolean[] = peaks.map((p) => p > thresh);
  const pauses: { t: number; len: number }[] = [];
  let voicedFrames = 0;
  let i = 0;
  while (i < voiced.length) {
    if (voiced[i]) {
      voicedFrames++;
      i++;
      continue;
    }
    let j = i;
    while (j < voiced.length && !voiced[j]) j++;
    const len = (j - i) * dt;
    if (len >= 0.4 && i > 0 && j < voiced.length) pauses.push({ t: i * dt, len });
    i = j;
  }
  // 合并 <0.15s 间隔的相邻停顿
  const merged: { t: number; len: number }[] = [];
  for (const p of pauses) {
    const last = merged[merged.length - 1];
    if (last && p.t - (last.t + last.len) < 0.15) {
      last.len += p.len + (p.t - (last.t + last.len));
    } else merged.push({ ...p });
  }
  const wpm = attempt.transcript
    ? estimateRate(attempt.transcript, dur).wpm || estimateRate(attempt.transcript, dur).cpm
    : undefined;
  return {
    pauseCount: merged.length,
    avgPause: merged.length ? merged.reduce((s, p) => s + p.len, 0) / merged.length : 0,
    longestPause: merged.length ? merged.reduce((a, b) => (b.len > a.len ? b : a)) : null,
    phonationRatio: voicedFrames / voiced.length,
    wpm,
    longPausePositions: merged
      .filter((p) => p.len >= 1.5)
      .map((p) => Math.max(0, sourceStart + (attempt.userAudioStart || 0) + p.t)),
  };
}

function computeCoverage(sourceText: string | undefined, transcript: string, glossary: string[] = []): CoverageClues {
  if (!sourceText || !transcript) {
    return {
      available: false,
      reason: !sourceText ? '本段无源语文本（未导入稿件/字幕）' : '未填写译语转写，无法计算覆盖率',
      entities: [],
    };
  }
  const ents = [...new Set([...extractEntities(sourceText), ...glossary.map((g) => g.trim()).filter(Boolean)])];
  const low = transcript.toLowerCase();
  const list = ents.slice(0, 40).map((e) => ({ text: e, hit: low.includes(e.toLowerCase()) }));
  const hit = list.filter((e) => e.hit).length;
  return { available: true, entities: list, hitRate: list.length ? hit / list.length : undefined };
}

function computeFidelity(
  sourceText: string | undefined,
  transcript: string,
  sentences?: Sentence[],
): FidelityClues {
  if (!sourceText || !transcript) {
    return {
      available: false,
      reason: !sourceText
        ? '本段无源语文本（未导入稿件/字幕），无法给出忠实度线索'
        : '未填写译语转写，无法给出忠实度线索（可在复盘页补充）',
    };
  }
  const overlap = similarity(sourceText, transcript);
  const srcNums = extractEntities(sourceText).filter((e) => /\d/.test(e));
  const hitNums = srcNums.filter((n) => transcript.includes(n)).length;

  // 高风险片段：源语句与译语句的最大相似度低于阈值
  const risky: FidelityClues['riskySpans'] = [];
  if (sentences?.length) {
    const tSents = splitSentences(transcript);
    for (const s of sentences) {
      let best = 0;
      for (const t of tSents) best = Math.max(best, similarity(s.text, t));
      if (best < 0.22) risky.push({ start: s.start, end: s.end, reason: '译语中未找到与该句内容对应的表述' });
      else if (best < 0.4) risky.push({ start: s.start, end: s.end, reason: '内容词重叠偏低，建议回听核对' });
    }
  }
  return {
    available: true,
    tokenOverlap: overlap,
    numberMatch: { total: srcNums.length, hit: hitNums },
    riskySpans: risky.slice(0, 12),
  };
}

export const fmtSec = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

/** 训练计时器用：始终两位分钟（00:07），避免大字排版跳动 */
export const fmtClock = (s: number) => {
  const safe = Math.max(0, Math.floor(s));
  const m = Math.floor(safe / 60);
  const r = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};

export const fmtSecPrecise = (s: number) => {
  const m = Math.floor(s / 60);
  const r = (s % 60).toFixed(1);
  return `${m}:${Number(r) < 10 ? '0' : ''}${r}`;
};
