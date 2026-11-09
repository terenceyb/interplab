import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, EyeOff, Maximize2, Minimize2, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SlideImage } from '@/components/SlideImage';
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
  /** 深色训练态（默认已是深色底，可关闭用于素材页预览） */
  dark?: boolean;
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
  fs,
}: {
  text: string;
  terms: string[];
  highlightTerms: boolean;
  maskMode: 'none' | 'tail' | 'random';
  maskRatio: number;
  fs: number;
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
          <span key={i} className="rounded bg-white/15 px-1 text-transparent" style={{ fontSize: fs }}>
            {'█'.repeat(Math.min(14, Math.max(3, Math.round(p.text.replace(/\s/g, '').length / 2))))}
          </span>
        ) : termRe ? (
          p.text.split(termRe).map((seg, j) =>
            termRe.test(seg) ? (
              <span key={`${i}-${j}`} className="rounded-sm bg-amber-300/25 px-0.5 font-medium text-amber-200">
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
 * 幻灯片 / PDF 手动翻页器。
 * 不跟随音视频时间轴，按页手动翻页（← / → 或按钮 / 页点），
 * 训练时可全屏放大到整屏，还原「看屏翻译」的实战视角。
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
  allowFullscreen = false,
  className,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
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
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-slate-900/60 text-slate-400">
        <EyeOff className="mb-2 h-6 w-6" />
        <p className="text-sm">幻灯片已隐藏 · 纯听状态</p>
        <p className="mt-1 text-xs">按 H 或右上角开关恢复</p>
      </div>
    );
  }

  const hasImage = cur.images.length > 0;
  const pageLabel = cur.page ? `第 ${cur.page} 页` : `第 ${cur.index + 1} 页`;

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-2', className)}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={boxRef}
          className={cn(
            'min-h-0 flex-1 overflow-y-auto rounded-lg bg-slate-900 p-5 text-slate-100 shadow-inner sm:p-7',
            full && 'fixed inset-0 z-50 rounded-none p-10',
          )}
          style={{ fontSize, lineHeight }}
        >
          <div className={cn('flex gap-6', hasImage ? 'flex-col lg:flex-row' : 'flex-col')}>
            <div className="min-w-0 flex-1">
              {cur.title ? (
                <h3 className="mb-4 border-b border-white/15 pb-3 text-[1.3em] font-semibold leading-snug text-white">
                  <SlideText
                    text={cur.title}
                    terms={terms}
                    highlightTerms={highlightTerms}
                    maskMode={maskMode}
                    maskRatio={maskRatio}
                    fs={fontSize}
                  />
                </h3>
              ) : null}
              {cur.bullets.length ? (
                <ul className="space-y-2.5">
                  {cur.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400/80" />
                      <span className="min-w-0 flex-1">
                        <SlideText
                          text={b}
                          terms={terms}
                          highlightTerms={highlightTerms}
                          maskMode={maskMode}
                          maskRatio={maskRatio}
                          fs={fontSize}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {!cur.title && !cur.bullets.length ? (
                <p className="text-sm text-slate-400">（本页无文字内容，可能是纯图片页）</p>
              ) : null}
              {showNotes && cur.notes ? (
                <p className="mt-4 border-t border-white/10 pt-3 text-[0.8em] text-slate-400">备注：{cur.notes}</p>
              ) : null}
            </div>
            {hasImage ? (
              <div className="shrink-0 space-y-2 lg:w-[42%]">
                {cur.images.slice(0, 2).map((src, i) => (
                  <SlideImage
                    key={src}
                    src={src}
                    alt={`${pageLabel} 配图 ${i + 1}`}
                    className="w-full rounded border border-white/10 object-contain"
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* 全屏时的悬浮翻页条：Esc 退出 */}
        {full ? (
          <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-200 shadow-xl backdrop-blur">
            <button className="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-40" disabled={index <= 0} onClick={() => go(index - 1)}>
              上一页
            </button>
            <span className="tabular-nums text-slate-400">
              {index + 1} / {slides.length}
            </span>
            <button
              className="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-40"
              disabled={index >= slides.length - 1}
              onClick={() => go(index + 1)}
            >
              下一页
            </button>
            <span className="mx-1 h-3 w-px bg-white/15" />
            <button className="rounded px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white" onClick={() => setFull(false)}>
              退出（Esc）
            </button>
          </div>
        ) : null}

        {/* 页码水印 */}
        <div className="pointer-events-none absolute right-3 top-2 rounded bg-black/30 px-1.5 py-0.5 text-[11px] tabular-nums text-white/50">
          {pageLabel} / 共 {slides.length} 页
        </div>
      </div>

      {/* 翻页控制 */}
      <div className="flex shrink-0 items-center justify-between gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-slate-200 hover:bg-white/10"
          disabled={index <= 0}
          onClick={() => go(index - 1)}
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> 上一页
        </Button>
        <div className="flex max-w-[45%] items-center gap-1 overflow-x-auto">
          {slides.slice(0, 40).map((_, i) => (
            <button
              key={i}
              onClick={() => go(i)}
              className={cn(
                'h-1.5 shrink-0 rounded-full transition-all',
                i === index ? 'w-5 bg-sky-400' : 'w-1.5 bg-white/25 hover:bg-white/50',
              )}
              title={`第 ${i + 1} 页`}
            />
          ))}
          <span className="ml-2 shrink-0 text-xs tabular-nums text-slate-400">
            {index + 1} / {slides.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {cur.notes ? (
            <Button
              size="sm"
              variant="ghost"
              className={cn('h-7 text-slate-300 hover:bg-white/10', showNotes && 'text-amber-300')}
              title="显示/隐藏备注"
              onClick={() => setShowNotes((v) => !v)}
            >
              <StickyNote className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {allowFullscreen ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-slate-300 hover:bg-white/10"
              title={full ? '退出全屏（Esc）' : '全屏看稿'}
              onClick={() => setFull((v) => !v)}
            >
              {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-slate-200 hover:bg-white/10"
            disabled={index >= slides.length - 1}
            onClick={() => go(index + 1)}
          >
            下一页 <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
