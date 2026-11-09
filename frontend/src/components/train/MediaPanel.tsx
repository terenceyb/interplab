import { Mic, Timer } from 'lucide-react';
import { Waveform } from '@/components/Waveform';
import { VideoStage } from '@/components/VideoStage';
import { LevelMeter } from '@/components/NotePad';
import { fmtClock, fmtSec } from '@/lib/metrics';
import { cn } from '@/lib/utils';

/**
 * 「音视频」模块：有视频就放画面，纯音频就把波形放大当主视觉。
 * 训练时视线从这块移到幻灯片区，再落到下方稿件区——听 / 看 / 译三件事在同一屏内完成。
 */
export function MediaPanel({
  isVideo,
  el,
  peaks,
  duration,
  trim,
  time,
  elapsed,
  level,
  markers,
  recording,
  compact = false,
  extra,
  className,
}: {
  isVideo?: boolean;
  el?: HTMLMediaElement | null;
  peaks: number[];
  duration: number;
  trim: { start: number; end: number };
  /** 源语虚拟时间（秒） */
  time: number;
  /** 译语已录时长 */
  elapsed: number;
  level?: { rms: number; wave: number[] };
  markers?: { t: number; color: string }[];
  recording?: boolean;
  /** 模块被压扁时收缩留白 */
  compact?: boolean;
  extra?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-2 overflow-hidden p-2', className)}>
      {isVideo && el ? (
        <VideoStage el={el} className="min-h-0 flex-1 rounded-lg" />
      ) : (
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30',
            compact ? 'py-2' : 'py-4',
          )}
        >
          <div className="font-mono text-4xl font-semibold tabular-nums tracking-tight">
            {fmtClock(time)}
            <span className="ml-2 text-sm font-normal text-muted-foreground">/ {fmtSec(duration)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Timer className="h-3 w-3" />
            源语音频
            {elapsed > 0 ? (
              <>
                <span className="mx-1 h-3 w-px bg-border" />
                <Mic className="h-3 w-3" />
                译语已录 {elapsed.toFixed(1)}s
              </>
            ) : null}
          </div>
          {extra}
        </div>
      )}

      <div className="shrink-0 rounded-md border bg-card/60 px-2 py-1.5">
        <Waveform
          peaks={peaks}
          duration={duration}
          height={compact ? 44 : 64}
          color="#38bdf8"
          cursor={time + trim.start}
          highlight={{ start: trim.start, end: trim.end }}
          markers={markers}
        />
      </div>

      {recording && level ? (
        <div className="shrink-0 rounded-md border border-rose-500/30 bg-rose-500/5 p-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-300">
            <Mic className="h-3 w-3 animate-pulse" /> 正在录制译语
          </div>
          <LevelMeter wave={level.wave} level={level.rms} />
        </div>
      ) : null}
    </div>
  );
}
