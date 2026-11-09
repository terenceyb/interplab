import { useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { maskSentence } from '@/lib/text';
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
  className?: string;
}

/** 幻灯片文字，支持术语高亮与遮挡训练 */
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
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(${list.map(esc).join('|')})`, 'gi');
  }, [terms, highlightTerms]);

  const pieces = maskMode === 'none' ? [{ text, masked: false }] : maskSentence(text, maskMode, maskRatio);

  return (
    <>
      {pieces.map((p, i) =>
        p.masked ? (
          <span key={i} className="rounded bg-white/15 px-1 text-white/40">
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
 * 幻灯片手动播放器。
 * PPT 稿件不跟随音视频时间轴，而是按页手动翻页（← / → 或按钮），
 * 保留原稿的「一页一屏」节奏；文字遮挡训练在这里同样生效。
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
  className,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cur = slides[Math.min(Math.max(0, index), slides.length - 1)];

  // 键盘翻页
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        onChange(Math.min(slides.length - 1, index + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        onChange(Math.max(0, index - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, slides.length, onChange]);

  // 翻页时回到顶部
  useEffect(() => {
    boxRef.current?.scrollTo({ top: 0 });
  }, [index]);

  if (!cur) return null;

  if (hide) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed bg-slate-900 text-slate-400">
        <EyeOff className="mb-2 h-6 w-6" />
        <p className="text-sm">稿件已隐藏 · 纯听模式</p>
        <p className="mt-1 text-xs">按 H 或右上角开关恢复</p>
      </div>
    );
  }

  const hasImage = cur.images.length > 0;

  return (
    <div className={cn('space-y-2', className)}>
      <div
        ref={boxRef}
        className="max-h-[46vh] overflow-y-auto rounded-lg bg-slate-900 p-6 text-slate-100 shadow-inner"
        style={{ fontSize, lineHeight }}
      >
        <div className={cn('flex gap-6', hasImage ? 'flex-col md:flex-row' : 'flex-col')}>
          <div className="min-w-0 flex-1">
            {cur.title ? (
              <h3 className="mb-4 border-b border-white/15 pb-3 text-[1.35em] font-semibold leading-snug text-white">
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
              <ul className="space-y-2">
                {cur.bullets.map((b, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400/80" />
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
              <p className="text-sm text-slate-400">（本页无文字内容，可能是纯图片页）</p>
            ) : null}
            {cur.notes ? (
              <p className="mt-4 border-t border-white/10 pt-3 text-[0.8em] text-slate-400">
                备注：{cur.notes}
              </p>
            ) : null}
          </div>
          {hasImage ? (
            <div className="shrink-0 space-y-2 md:w-[42%]">
              {cur.images.slice(0, 2).map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`第 ${cur.index + 1} 页配图 ${i + 1}`}
                  className="w-full rounded border border-white/10 object-contain"
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* 翻页控件 */}
      <div className="flex items-center justify-between rounded-md border bg-card px-2 py-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          disabled={index <= 0}
          onClick={() => onChange(Math.max(0, index - 1))}
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> 上一页
        </Button>
        <div className="flex items-center gap-1">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => onChange(i)}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === index ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60',
              )}
              title={`第 ${i + 1} 页`}
            />
          ))}
          <span className="ml-2 text-xs tabular-nums text-muted-foreground">
            {index + 1} / {slides.length}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          disabled={index >= slides.length - 1}
          onClick={() => onChange(Math.min(slides.length - 1, index + 1))}
        >
          下一页 <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
