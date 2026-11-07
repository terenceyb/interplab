import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface WaveMarker {
  t: number;
  color: string;
  label?: string;
  active?: boolean;
}

export interface WaveRegion {
  start: number;
  end: number;
  color?: string;
  label?: string;
}

interface Props {
  peaks: number[];
  duration: number;
  height?: number;
  color?: string;
  cursor?: number | null;
  markers?: WaveMarker[];
  regions?: WaveRegion[];
  onSeek?: (t: number) => void;
  showAxis?: boolean;
  className?: string;
  /** 高亮区间（如当前分段） */
  highlight?: { start: number; end: number };
}

/** 单轨波形：峰值镜像柱 + 播放头 + 标记 + 分段边界，支持点击定位 */
export function Waveform({
  peaks,
  duration,
  height = 96,
  color = '#38bdf8',
  cursor = null,
  markers = [],
  regions = [],
  onSeek,
  showAxis = true,
  className,
  highlight,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const box = boxRef.current;
    if (!canvas || !box) return;
    const w = box.clientWidth;
    const h = height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const dur = Math.max(0.001, duration);
    const xOf = (t: number) => (t / dur) * w;
    const axisH = showAxis ? 16 : 0;
    const waveH = h - axisH;
    const mid = waveH / 2;

    // 分段背景
    regions.forEach((r, i) => {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(148,163,184,0.05)' : 'rgba(148,163,184,0.02)';
      ctx.fillRect(xOf(r.start), 0, Math.max(1, xOf(r.end) - xOf(r.start)), waveH);
      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.beginPath();
      ctx.moveTo(xOf(r.start), 0);
      ctx.lineTo(xOf(r.start), waveH);
      ctx.stroke();
      if (r.label) {
        ctx.fillStyle = 'rgba(203,213,225,0.7)';
        ctx.font = '10px system-ui';
        ctx.fillText(r.label, xOf(r.start) + 3, 10);
      }
    });

    // 高亮
    if (highlight) {
      ctx.fillStyle = 'rgba(56,189,248,0.12)';
      ctx.fillRect(xOf(highlight.start), 0, Math.max(1, xOf(highlight.end) - xOf(highlight.start)), waveH);
    }

    // 波形
    const n = peaks.length;
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const x = xOf((i / n) * dur);
      const nextX = xOf(((i + 1) / n) * dur);
      const bw = Math.max(0.8, nextX - x);
      const amp = Math.max(1, peaks[i] * (mid - 2));
      ctx.fillRect(x, mid - amp, bw, amp * 2);
    }
    ctx.strokeStyle = 'rgba(148,163,184,0.25)';
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();

    // 标记
    for (const m of markers) {
      const x = xOf(m.t);
      ctx.strokeStyle = m.color;
      ctx.globalAlpha = m.active ? 1 : 0.75;
      ctx.lineWidth = m.active ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, waveH);
      ctx.stroke();
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.moveTo(x - 4, 0);
      ctx.lineTo(x + 4, 0);
      ctx.lineTo(x, 6);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    }

    // 播放头
    if (cursor != null) {
      const x = xOf(cursor);
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, waveH);
      ctx.stroke();
      ctx.fillStyle = '#f87171';
      ctx.beginPath();
      ctx.moveTo(x - 4, waveH);
      ctx.lineTo(x + 4, waveH);
      ctx.lineTo(x, waveH - 6);
      ctx.closePath();
      ctx.fill();
    }

    // 时间轴
    if (showAxis) {
      ctx.fillStyle = 'rgba(148,163,184,0.7)';
      ctx.font = '10px system-ui';
      const step = dur > 600 ? 120 : dur > 180 ? 60 : dur > 60 ? 30 : 10;
      for (let t = 0; t <= dur; t += step) {
        const x = xOf(t);
        ctx.fillRect(x, waveH, 1, 4);
        const m = Math.floor(t / 60);
        const s = Math.round(t % 60);
        ctx.fillText(`${m}:${String(s).padStart(2, '0')}`, x + 2, h - 3);
      }
    }
  }, [peaks, duration, height, color, cursor, markers, regions, showAxis, highlight]);

  return (
    <div
      ref={boxRef}
      className={cn('w-full select-none', onSeek && 'cursor-pointer', className)}
      onClick={(e) => {
        if (!onSeek) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const t = ((e.clientX - rect.left) / rect.width) * duration;
        onSeek(Math.max(0, Math.min(duration, t)));
      }}
    >
      <canvas ref={ref} />
    </div>
  );
}

interface DualProps {
  srcPeaks: number[];
  srcDuration: number;
  userPeaks: number[];
  userDuration: number;
  /** 译语录音 0 时刻对应的源语时间 */
  userOffset: number;
  cursor: number | null;
  markers?: WaveMarker[];
  segments?: WaveRegion[];
  onSeek?: (t: number) => void;
  height?: number;
}

/** 双轨波形：上轨源语、下轨译语，共享同一时间轴（严格对齐） */
export function DualTrack({
  srcPeaks,
  srcDuration,
  userPeaks,
  userDuration,
  userOffset,
  cursor,
  markers = [],
  segments = [],
  onSeek,
  height = 88,
}: DualProps) {
  const total = Math.max(srcDuration, userOffset + userDuration);
  // 译语轨按 offset 平移：构造与源语同轴的峰值数组
  const shifted = useMemo(() => {
    const totalBuckets = Math.max(1, Math.min(24000, Math.floor(total * 40)));
    const out = new Array<number>(totalBuckets).fill(0);
    const startB = Math.floor(userOffset * 40);
    const n = Math.min(userPeaks.length, totalBuckets - startB);
    for (let i = 0; i < n; i++) {
      const idx = startB + i;
      if (idx >= 0 && idx < totalBuckets) out[idx] = userPeaks[i];
    }
    return out;
  }, [userPeaks, userOffset, total]);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-block h-2 w-2 rounded-sm bg-sky-400" />
        源语轨
      </div>
      <Waveform
        peaks={srcPeaks}
        duration={total}
        height={height}
        color="#38bdf8"
        cursor={cursor}
        markers={markers}
        regions={segments}
        onSeek={onSeek}
      />
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-block h-2 w-2 rounded-sm bg-emerald-400" />
        译语轨
      </div>
      <Waveform
        peaks={shifted}
        duration={total}
        height={height}
        color="#34d399"
        cursor={cursor}
        markers={markers}
        onSeek={onSeek}
      />
    </div>
  );
}
