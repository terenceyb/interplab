import { useEffect, useMemo, useRef } from 'react';
import type { DocBlock, Sentence } from '@/types';
import { escapeRe, maskSentence } from '@/lib/text';
import { cn } from '@/lib/utils';

interface Props {
  sentences: Sentence[];
  currentIdx: number;
  terms?: string[];
  highlightTerms?: boolean;
  maskMode?: 'none' | 'tail' | 'random';
  maskRatio?: number;
  fontSize?: number;
  lineHeight?: number;
  hide?: boolean;
  /**
   * 是否跟随播放高亮。
   * false 时只做静态呈现（默认行为）：不高亮、不淡化、不自动滚动。
   */
  follow?: boolean;
  /** 段落块结构：还原标题 / 段落 / 列表 / 引用，保留原文换行 */
  blocks?: DocBlock[];
  onSentenceClick?: (i: number) => void;
  className?: string;
}

interface Group {
  block?: DocBlock;
  items: { s: Sentence; gi: number }[];
}

/** 带稿同传文本视图：保留段落结构 + 术语标记 + 遮挡训练 + 可选跟随 */
export function ScriptView({
  sentences,
  currentIdx,
  terms = [],
  highlightTerms = true,
  maskMode = 'none',
  maskRatio = 0.2,
  fontSize = 18,
  lineHeight = 1.9,
  hide = false,
  follow = true,
  blocks,
  onSentenceClick,
  className,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!follow) return;
    const el = activeRef.current;
    const box = boxRef.current;
    if (!el || !box) return;
    const top = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [currentIdx, follow]);

  const termRe = useMemo(() => {
    const list = terms.filter((t) => t.trim().length > 1).slice(0, 200);
    if (!list.length) return null;
    return new RegExp(`(${list.map(escapeRe).join('|')})`, 'gi');
  }, [terms]);

  /** 按块分组，未提供 blocks 时整体视为一段 */
  const groups = useMemo<Group[]>(() => {
    const out: Group[] = [];
    let lastBi = -1;
    sentences.forEach((s, gi) => {
      const bi = s.block ?? 0;
      if (bi !== lastBi) {
        out.push({ block: blocks?.[bi], items: [] });
        lastBi = bi;
      }
      out[out.length - 1].items.push({ s, gi });
    });
    return out;
  }, [sentences, blocks]);

  if (hide) {
    return (
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-md border border-dashed text-muted-foreground">
        <p className="text-sm font-medium">稿件已隐藏 · 纯听状态</p>
        <p className="mt-1 text-xs opacity-70">按 H 或右上角开关恢复 · 模拟无稿实战</p>
      </div>
    );
  }

  const renderText = (text: string, masked: boolean) => {
    if (masked) {
      return (
        <span className="rounded bg-muted px-1 text-transparent" title="遮挡训练">
          {'█'.repeat(Math.min(12, Math.max(2, Math.round(text.replace(/\s/g, '').length / 2))))}
        </span>
      );
    }
    if (!highlightTerms || !termRe) return text;
    const parts = text.split(termRe);
    return parts.map((p, i) =>
      termRe.test(p) ? (
        <span
          key={i}
          className="rounded-sm bg-amber-100 px-0.5 font-medium text-amber-900 underline decoration-amber-400 decoration-2 underline-offset-2 dark:bg-amber-300/20 dark:text-amber-200 dark:decoration-amber-400/70"
        >
          {p}
        </span>
      ) : (
        <span key={i}>{p}</span>
      ),
    );
  };

  const renderSentence = ({ s, gi }: { s: Sentence; gi: number }) => {
    const state = !follow ? 'idle' : gi < currentIdx ? 'read' : gi === currentIdx ? 'current' : 'future';
    const pieces =
      maskMode === 'none' ? [{ text: s.text, masked: false }] : maskSentence(s.text, maskMode, maskRatio);
    return (
      <span
        key={s.id}
        ref={state === 'current' ? activeRef : undefined}
        onClick={() => onSentenceClick?.(gi)}
        className={cn(
          'cursor-pointer rounded px-0.5 transition-colors',
          state === 'current' && 'bg-amber-200/60 font-medium dark:bg-amber-300/15',
          state === 'read' && 'text-muted-foreground/60',
        )}
      >
        {pieces.map((p, j) => (
          <span key={j}>{renderText(p.text, p.masked)}</span>
        ))}
        <span> </span>
      </span>
    );
  };

  return (
    <div
      ref={boxRef}
      className={cn('h-full overflow-y-auto rounded-lg border bg-card px-5 py-4', className)}
      style={{ fontSize, lineHeight }}
    >
      {groups.map((g, gidx) => {
        const type = g.block?.type ?? 'para';
        const body = g.items.map(renderSentence);
        if (type === 'heading' || type === 'title') {
          const lv = g.block?.level ?? 1;
          return (
            <h3
              key={gidx}
              className={cn(
                'mb-2 mt-4 border-b pb-1 font-semibold first:mt-0',
                lv <= 1 ? 'text-[1.15em]' : 'text-[1.05em]',
              )}
            >
              {body}
            </h3>
          );
        }
        if (type === 'li') {
          return (
            <div key={gidx} className="mb-1.5 flex gap-2">
              <span className="mt-[0.75em] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span className="min-w-0 flex-1">{body}</span>
            </div>
          );
        }
        if (type === 'quote') {
          return (
            <blockquote key={gidx} className="mb-2 border-l-2 border-amber-400 pl-3 text-muted-foreground">
              {body}
            </blockquote>
          );
        }
        return (
          <p key={gidx} className="mb-2.5">
            {body}
          </p>
        );
      })}
      {!sentences.length ? <p className="text-sm opacity-60">（稿件为空）</p> : null}
    </div>
  );
}

/** 无稿同传 / 影子练习：EVS 目标导航条 */
export function EvsBar({
  sourceT,
  duration,
  target,
}: {
  sourceT: number;
  duration: number;
  target: number;
}) {
  const pct = duration > 0 ? (sourceT / duration) * 100 : 0;
  const lagT = Math.max(0, sourceT - target);
  const lagPct = duration > 0 ? (lagT / duration) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="relative h-2 w-full rounded-full bg-muted">
        <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-500/70" style={{ width: `${pct}%` }} />
        <div
          className="absolute -top-1 h-4 w-1 rounded bg-amber-400"
          style={{ left: `${lagPct}%` }}
          title={`目标滞后 ${target}s：此刻应正在译该位置`}
        />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>源语进度 {sourceT.toFixed(1)}s</span>
        <span className="text-amber-600 dark:text-amber-400">
          目标 EVS {target}s · 应译至 {lagT.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}
