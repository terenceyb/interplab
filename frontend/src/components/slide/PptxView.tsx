import { useEffect, useMemo, useRef, useState } from 'react';
import type { Scene, ScenePara, SceneShape } from '@/lib/slideScene';
import { SlideImage } from '@/components/SlideImage';
import { cn } from '@/lib/utils';

/**
 * 按原版式渲染一页 PPTX。
 *
 * 思路：幻灯片尺寸归一到容器宽度，所有长度用 cqw（容器宽度的 1%）表达，
 * 字号用「磅 → 占幻灯片宽度的百分比」换算，于是整页会跟着容器等比缩放，
 * 放大窗口、拖窄模块都保持原比例，不需要用 canvas 也不需要重新计算。
 */
export function PptxSlideView({
  scene,
  index,
  className,
}: {
  scene: Scene;
  index: number;
  className?: string;
}) {
  const slide = scene.slides[index];
  /** 磅 → cqw */
  const toCqw = useMemo(() => (pt: number) => (pt / scene.widthPt) * 100, [scene.widthPt]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // 按「宽高都放得下」等比缩放：模块被压扁时整页缩小，而不是把下半页切掉
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); // observe 时会立即回调一次，不用在这里同步 setState
    return () => ro.disconnect();
  }, []);

  if (!slide) return null;

  const fitW = box.w && box.h ? Math.min(box.w, box.h * scene.ratio) : box.w;

  return (
    <div
      ref={wrapRef}
      className={cn('flex h-full w-full items-center justify-center overflow-hidden rounded bg-muted/40', className)}
    >
      <div
        className="relative overflow-hidden bg-white shadow-sm ring-1 ring-black/5"
        style={{ width: fitW || '100%', aspectRatio: `${scene.ratio}`, containerType: 'inline-size' }}
      >
        {slide.bgImg ? (
          <SlideImage src={slide.bgImg} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0" style={{ background: slide.bg ?? '#FFFFFF' }} />
        )}
        {slide.shapes.map((s, i) => (
          <Shape key={i} shape={s} toCqw={toCqw} />
        ))}
      </div>
    </div>
  );
}

function Shape({ shape, toCqw }: { shape: SceneShape; toCqw: (pt: number) => number }) {
  const box: React.CSSProperties = {
    position: 'absolute',
    left: `${shape.x * 100}%`,
    top: `${shape.y * 100}%`,
    width: `${shape.w * 100}%`,
    height: `${shape.h * 100}%`,
    transform: shape.rot ? `rotate(${shape.rot}deg)` : undefined,
    borderRadius: shape.ellipse ? '50%' : shape.radius ? `${shape.radius * 100}%` : undefined,
    background: shape.fill,
    border: shape.stroke
      ? `${Math.max(0.08, toCqw(shape.stroke.w))}cqw solid ${shape.stroke.color}`
      : undefined,
    overflow: 'hidden',
    boxSizing: 'border-box',
  };

  if (shape.kind === 'image' && shape.img) {
    return (
      <div style={box}>
        <SlideImage src={shape.img} alt="" className="h-full w-full object-contain" />
      </div>
    );
  }

  if (shape.kind === 'table' && shape.table) {
    const total = shape.table.cols.reduce((a, b) => a + b, 0) || 1;
    const cols = shape.table.cols.map((w) => `${(w / total) * 100}%`).join(' ');
    return (
      <div style={{ ...box, display: 'grid', gridTemplateColumns: cols, background: shape.fill ?? '#FFFFFF' }}>
        {shape.table.rows.map((row, r) =>
          row.map((cell, c) => (
            <div
              key={`${r}-${c}`}
              style={{
                border: `${Math.max(0.08, toCqw(0.75))}cqw solid rgba(0,0,0,0.18)`,
                padding: `${toCqw(3)}cqw ${toCqw(5)}cqw`,
                fontSize: `${toCqw(11)}cqw`,
                color: '#1f2937',
                lineHeight: 1.25,
                overflow: 'hidden',
              }}
            >
              {cell}
            </div>
          )),
        )}
      </div>
    );
  }

  if (!shape.text?.length) return <div style={box} />;

  const [l, t, r, b] = shape.inset ?? [0, 0, 0, 0];
  return (
    <div
      style={{
        ...box,
        display: 'flex',
        flexDirection: 'column',
        justifyContent:
          shape.anchor === 'middle' ? 'center' : shape.anchor === 'bottom' ? 'flex-end' : 'flex-start',
        padding: `${toCqw(t / 12700)}cqw ${toCqw(r / 12700)}cqw ${toCqw(b / 12700)}cqw ${toCqw(l / 12700)}cqw`,
        color: '#000000',
        lineHeight: 1.18,
      }}
    >
      {shape.text.map((para, i) => (
        <Para key={i} para={para} toCqw={toCqw} />
      ))}
    </div>
  );
}

function Para({ para, toCqw }: { para: ScenePara; toCqw: (pt: number) => number }) {
  return (
    <p
      style={{
        margin: 0,
        textAlign: para.align,
        lineHeight: para.lineHeight ?? 1.18,
        marginBottom: para.spaceAfter ? `${toCqw(para.spaceAfter / 12700)}cqw` : undefined,
        marginLeft: para.indent ? `${toCqw(para.indent / 12700)}cqw` : undefined,
        wordBreak: 'break-word',
      }}
    >
      {para.bullet ? <span style={{ marginRight: `${toCqw(4)}cqw` }}>{para.bullet}</span> : null}
      {para.runs.map((run, i) =>
        run.br ? (
          <br key={i} />
        ) : (
          <span
            key={i}
            style={{
              fontWeight: run.b ? 700 : 400,
              fontStyle: run.i ? 'italic' : undefined,
              textDecoration: run.u ? 'underline' : undefined,
              fontSize: `${toCqw((run.sz ?? 1800) / 100)}cqw`,
              color: run.color,
            }}
          >
            {run.t}
          </span>
        ),
      )}
    </p>
  );
}
