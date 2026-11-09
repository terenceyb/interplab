import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  EyeOff,
  FileText,
  Layers,
  Maximize2,
  Minimize2,
  StickyNote,
} from 'lucide-react';
import { SlideImage } from '@/components/SlideImage';
import { SlideSurface, slideKindOf } from '@/components/slide/SlideSurface';
import { maskSentence, escapeRe } from '@/lib/text';
import { cn } from '@/lib/utils';
import type { SlideData } from '@/types';

interface Props {
  slides: SlideData[];
  index: number;
  onChange: (i: number) => void;
  fontSize?: number;
  lineHeight?: number;
  hide?: boolean;
  maskMode?: 'none' | 'tail' | 'random';
  maskRatio?: number;
  terms?: string[];
  highlightTerms?: boolean;
  /** 原始文件（PPTX / PDF）在 IndexedDB 的 key，有则默认按原版式呈现 */
  sourceKey?: string;
  /** 原始文件名，用于判断渲染方式 */
  fileName?: string;
  /** 是否允许全屏放大（训练页开启） */
  allowFullscreen?: boolean;
  className?: string;
}

/** 幻灯片文字：支持术语高亮与遮挡训练 */
function SlideText({
  text,
  terms,
  highlightTerms,
  maskMode,
  maskRatio,
}: {
  text: string;
  terms: string[];
  highlightTerms: boolean;
  maskMode: 'none' | 'tail' | 'random';
  maskRatio: number;
}) {
  const termRe = useMemo(() => {
    const list = terms.filter((t) => t.trim().length > 1).slice(0, 200);
    if (!list.length || !highlightTerms) return null;
    return new RegExp(`(${list.map(escapeRe).join('|')})`, 'gi');
  }, [terms, highlightTerms]);

  const pieces = maskMode === 'none' ? [{ text, masked: false }] : maskSentence(text, maskMode, maskRatio);

  return (
    <>
      {pieces.map((p, i) =>
        p.masked ? (
          <span key={i} className="rounded bg-muted px-1 text-transparent">
            {'█'.repeat(Math.min(14, Math.max(3, Math.round(p.text.replace(/\s/g, '').length / 2))))}
          </span>
        ) : termRe ? (
          p.text.split(termRe).map((seg, j) =>
            termRe.test(seg) ? (
              <span
                key={`${i}-${j}`}
                className="rounded-sm bg-amber-200/70 px-0.5 font-medium text-amber-900 dark:bg-amber-300/25 dark:text-amber-200"
              >
                {seg}
              </span>
            ) : (
              <span key={`${i}-${j}`}>{seg}</span>
            ),
          )
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/**
 * 幻灯片 / PDF 翻页器。
 *
 * 两种呈现：
 *  - 原版式（默认）：PDF 画 canvas、PPTX 还原母版与形状位置，和投影仪上看到的一致；
 *  - 文字版：抽取出来的标题 + 要点，便于做术语高亮与遮挡训练。
 * 按页手动翻页（← / → / 按钮 / 页点），可全屏放大，还原「看屏翻译」的实战视角。
 */
export function SlideDeck({
  slides,
  index,
  onChange,
  fontSize = 18,
  lineHeight = 1.7,
  hide = false,
  maskMode = 'none',
  maskRatio = 0.2,
  terms = [],
  highlightTerms = true,
  sourceKey,
  fileName,
  allowFullscreen = false,
  className,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const kind = slideKindOf(fileName);
  const canOriginal = kind !== 'none' && !!sourceKey;
  /** 用户手动切过的方式只在同一份文件上生效，换了素材自动回到「能原版式就原版式」 */
  const sourceTag = sourceKey ?? fileName ?? '';
  const [choice, setChoice] = useState<{ tag: string; mode: 'original' | 'text' } | null>(null);
  const mode = choice && choice.tag === sourceTag ? choice.mode : canOriginal ? 'original' : 'text';
  const setMode = (next: 'original' | 'text') => setChoice({ tag: sourceTag, mode: next });
  const cur = slides[Math.min(Math.max(0, index), slides.length - 1)];

  const go = useCallback(
    (i: number) => onChange(Math.min(slides.length - 1, Math.max(0, i))),
    [onChange, slides.length],
  );

  // 键盘翻页（全屏时同样生效）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        go(index + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        go(index - 1);
      } else if (e.key === 'Escape' && full) {
        setFull(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, go, full]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: 0 });
  }, [index]);

  if (!cur) return null;

  if (hide) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed text-muted-foreground">
        <EyeOff className="mb-2 h-6 w-6" />
        <p className="text-sm">幻灯片已隐藏 · 纯听状态</p>
        <p className="mt-1 text-xs">按 H 或右上角开关恢复</p>
      </div>
    );
  }

  const pageLabel = cur.page ? `第 ${cur.page} 页` : `第 ${cur.index + 1} 页`;
  const original = mode === 'original' && canOriginal;

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-2', className)}>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
        <div
          ref={boxRef}
          className={cn('min-h-0 flex-1 overflow-auto p-3 sm:p-4', full && 'fixed inset-0 z-50 rounded-none p-8')}
          style={original ? undefined : { fontSize, lineHeight }}
        >
          {original ? (
            <SlideSurface
              sourceKey={sourceKey}
              kind={kind}
              pageNo={cur.page ?? index + 1}
              index={index}
              className={full ? 'max-h-full' : undefined}
            />
          ) : (
            <div className={cn('flex gap-6', cur.images.length ? 'flex-col lg:flex-row' : 'flex-col')}>
              <div className="min-w-0 flex-1">
                {cur.title ? (
                  <h3 className="mb-4 border-b pb-3 text-[1.3em] font-semibold leading-snug">
                    <SlideText
                      text={cur.title}
                      terms={terms}
                      highlightTerms={highlightTerms}
                      maskMode={maskMode}
                      maskRatio={maskRatio}
                    />
                  </h3>
                ) : null}
                {cur.bullets.length ? (
                  <ul className="space-y-2.5">
                    {cur.bullets.map((b, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                        <span className="min-w-0 flex-1">
                          <SlideText
                            text={b}
                            terms={terms}
                            highlightTerms={highlightTerms}
                            maskMode={maskMode}
                            maskRatio={maskRatio}
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!cur.title && !cur.bullets.length ? (
                  <p className="text-sm text-muted-foreground">（本页无文字内容，可能是纯图片页）</p>
                ) : null}
                {showNotes && cur.notes ? (
                  <p className="mt-4 border-t pt-3 text-[0.8em] text-muted-foreground">备注：{cur.notes}</p>
                ) : null}
              </div>
              {cur.images.length ? (
                <div className="shrink-0 space-y-2 lg:w-[42%]">
                  {cur.images.slice(0, 2).map((src, i) => (
                    <SlideImage
                      key={src}
                      src={src}
                      alt={`${pageLabel} 配图 ${i + 1}`}
                      className="w-full rounded border object-contain"
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* 全屏时的悬浮翻页条：Esc 退出 */}
        {full ? (
          <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-card/95 px-3 py-1.5 text-xs shadow-xl backdrop-blur">
            <button
              className="rounded px-2 py-1 hover:bg-accent disabled:opacity-40"
              disabled={index <= 0}
              onClick={() => go(index - 1)}
            >
              上一页
            </button>
            <span className="tabular-nums text-muted-foreground">
              {index + 1} / {slides.length}
            </span>
            <button
              className="rounded px-2 py-1 hover:bg-accent disabled:opacity-40"
              disabled={index >= slides.length - 1}
              onClick={() => go(index + 1)}
            >
              下一页
            </button>
            <span className="mx-1 h-3 w-px bg-border" />
            <button className="rounded px-2 py-1 text-muted-foreground hover:bg-accent" onClick={() => setFull(false)}>
              退出（Esc）
            </button>
          </div>
        ) : null}

        {/* 页码水印 */}
        <div className="pointer-events-none absolute right-2 top-2 rounded bg-foreground/70 px-1.5 py-0.5 text-[11px] tabular-nums text-background">
          {pageLabel} / 共 {slides.length} 页
        </div>
      </div>

      {/* 翻页与呈现方式 */}
      <div className="flex shrink-0 items-center gap-1 rounded-md border bg-card px-2 py-1.5">
        <button
          className="flex h-7 items-center gap-1 rounded px-2 text-xs hover:bg-accent disabled:opacity-40"
          disabled={index <= 0}
          onClick={() => go(index - 1)}
        >
          <ChevronLeft className="h-4 w-4" /> 上一页
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto">
          {slides.slice(0, 40).map((_, i) => (
            <button
              key={i}
              onClick={() => go(i)}
              className={cn(
                'h-1.5 shrink-0 rounded-full transition-all',
                i === index ? 'w-5 bg-sky-500' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60',
              )}
              title={`第 ${i + 1} 页`}
            />
          ))}
          <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
            {index + 1} / {slides.length}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {canOriginal ? (
            <button
              onClick={() => setMode(mode === 'original' ? 'text' : 'original')}
              className={cn(
                'flex h-7 items-center gap-1 rounded px-1.5 text-[11px] hover:bg-accent',
                mode === 'original' ? 'text-foreground' : 'text-muted-foreground',
              )}
              title={mode === 'original' ? '切换为可遮挡的文字版' : '切换回原版式'}
            >
              {mode === 'original' ? <Layers className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
              {mode === 'original' ? '原版式' : '文字版'}
            </button>
          ) : null}
          {cur.notes ? (
            <button
              className={cn('flex h-7 w-7 items-center justify-center rounded hover:bg-accent', showNotes && 'text-amber-600')}
              title="显示/隐藏备注"
              onClick={() => setShowNotes((v) => !v)}
            >
              <StickyNote className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {allowFullscreen ? (
            <button
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-accent"
              title={full ? '退出全屏（Esc）' : '全屏看稿'}
              onClick={() => setFull((v) => !v)}
            >
              {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          ) : null}
          <button
            className="flex h-7 items-center gap-1 rounded px-2 text-xs hover:bg-accent disabled:opacity-40"
            disabled={index >= slides.length - 1}
            onClick={() => go(index + 1)}
          >
            下一页 <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
