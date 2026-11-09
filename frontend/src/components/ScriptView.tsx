import { useEffect, useMemo, useRef } from 'react';
import type { Sentence } from '@/types';
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
   * false 时只做静态呈现（默认行为）：不高亮、不淡化、不自动滚动，
   * 避免在「只呈现稿件」模式下被播放进度牵着走。
   */
  follow?: boolean;
  onSentenceClick?: (i: number) => void;
  className?: string;
}

/** 带稿同传文本视图：随音频进度高亮 + 术语标记 + 遮挡训练 */
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

  if (hide) {
    return (
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-md border border-dashed text-muted-foreground">
        <p className="text-sm">文本已隐藏 · 纯听模式</p>
        <p className="mt-1 text-xs">用于自我检测是否过度依赖稿件</p>
      </div>
    );
  }

  const renderText = (text: string, masked: boolean) => {
    if (masked) {
      return (
        <span className="rounded bg-muted px-1 text-muted-foreground" title="遮挡训练">
          {'█'.repeat(Math.min(12, Math.max(2, Math.round(text.replace(/\s/g, '').length / 2))))}
        </span>
      );
    }
    if (!highlightTerms || !termRe) return text;
    const parts = text.split(termRe);
    return parts.map((p, i) =>
      termRe.test(p) ? (
        <span key={i} className="rounded-sm bg-amber-100 px-0.5 font-medium text-amber-900 underline decoration-amber-400 decoration-2 underline-offset-2">
          {p}
        </span>
      ) : (
        <span key={i}>{p}</span>
      ),
    );
  };

  return (
    <div
      ref={boxRef}
      className={cn('max-h-[52vh] overflow-y-auto rounded-md border bg-card p-4', className)}
      style={{ fontSize, lineHeight }}
    >
      {sentences.map((s, i) => {
        const state = !follow ? 'idle' : i < currentIdx ? 'read' : i === currentIdx ? 'current' : 'future';
        const pieces = maskMode === 'none' ? [{ text: s.text, masked: false }] : maskSentence(s.text, maskMode, maskRatio);
        return (
          <span key={s.id}>
            <span
              ref={state === 'current' ? activeRef : undefined}
              onClick={() => onSentenceClick?.(i)}
              className={cn(
                'cursor-pointer rounded px-1 transition-colors',
                state === 'current' && 'bg-primary/20 font-medium',
                state === 'read' && 'text-muted-foreground/60',
                state === 'future' && '',
              )}
            >
              {pieces.map((p, j) => (
                <span key={j}>{renderText(p.text, p.masked)}</span>
              ))}
            </span>
            <span> </span>
          </span>
        );
      })}
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
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary/60" style={{ width: `${pct}%` }} />
        <div
          className="absolute -top-1 h-4 w-1 rounded bg-amber-500"
          style={{ left: `${lagPct}%` }}
          title={`目标滞后 ${target}s：此刻应正在译该位置`}
        />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>源语进度 {sourceT.toFixed(1)}s</span>
        <span className="text-amber-600">目标 EVS {target}s · 应译至 {lagT.toFixed(1)}s</span>
      </div>
    </div>
  );
}
