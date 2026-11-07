import { useEffect, useRef, useState } from 'react';
import type { Stroke } from '@/types';

interface Props {
  strokes: Stroke[];
  onStroke?: (s: Stroke) => void;
  /** 当前相对时间（秒），用于回放：仅显示 t <= current 的笔迹 */
  current?: number;
  readOnly?: boolean;
  /** 计时起点（performance 时间基准由调用方换算为相对秒） */
  startedAt?: number;
  height?: number;
}

/** 数字笔记板：手写笔迹 + 时间戳，复盘时可逐笔重现 */
export function NotePad({ strokes, onStroke, current, readOnly, startedAt = 0, height = 180 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<[number, number][] | null>(null);
  const [tick, setTick] = useState(0);

  const visible = current == null ? strokes : strokes.filter((s) => s.t <= current);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // 横格背景
    ctx.strokeStyle = 'rgba(148,163,184,0.18)';
    for (let y = 24; y < h; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of visible) {
      ctx.beginPath();
      s.pts.forEach(([x, y], i) => {
        const px = x * w;
        const py = y * h;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  }, [visible, height, tick, strokes]);

  const pos = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as [number, number];
  };

  return (
    <canvas
      ref={ref}
      style={{ height }}
      className={`w-full rounded-md border bg-white ${readOnly ? '' : 'cursor-crosshair'} touch-none`}
      onPointerDown={(e) => {
        if (readOnly) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        drawing.current = [pos(e)];
      }}
      onPointerMove={(e) => {
        if (readOnly || !drawing.current) return;
        drawing.current.push(pos(e));
        setTick((t) => t + 1);
      }}
      onPointerUp={() => {
        if (readOnly || !drawing.current) return;
        const t = startedAt ? (performance.now() - startedAt) / 1000 : 0;
        onStroke?.({ t: Math.max(0, t), pts: drawing.current });
        drawing.current = null;
        setTick((t2) => t2 + 1);
      }}
    />
  );
}

/** 实时音量/波形条（录音中） */
export function LevelMeter({ wave, level }: { wave: number[]; level: number }) {
  return (
    <div className="flex h-12 items-center gap-[2px]">
      {(wave.length ? wave : new Array(32).fill(0)).map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-full bg-emerald-400 transition-[height] duration-75"
          style={{ height: `${Math.max(4, Math.min(100, Math.abs(v) * 180))}%` }}
        />
      ))}
      <div className="ml-2 w-10 text-right text-xs tabular-nums text-muted-foreground">
        {Math.round(level * 100)}
      </div>
    </div>
  );
}
