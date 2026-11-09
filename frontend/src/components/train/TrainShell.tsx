import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Mic,
  Pause,
  Play,
  Settings2,
  Square,
  Timer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtClock, fmtSec } from '@/lib/metrics';
import { MODE_LABEL, type TrainMode } from '@/types';
import { RateSelect } from '@/components/RateSelect';
import { ResourceMonitor } from '@/components/ResourceMonitor';

export type TrainStage = 'idle' | 'training' | 'paused' | 'done';

interface Props {
  mode: TrainMode;
  materialTitle: string;
  stage: TrainStage;
  /** 源语虚拟时间（秒） */
  time: number;
  /** 有效训练时长（秒） */
  duration: number;
  /** 译语已录时长（秒） */
  recorded?: number;
  rate: number;
  onRate: (r: number) => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onExit: () => void;
  busy?: boolean;
  /** 顶栏右侧附加控件（隐藏文本、跟随等） */
  extras?: React.ReactNode;
  /** 右侧战术面板 */
  rail?: React.ReactNode;
  railTitle?: string;
  /** 底栏提示 */
  hint?: string;
  /** 自定义底栏内容（交传的分段传输控制） */
  footer?: React.ReactNode;
  /** 自定义状态标签（如「听源语 / 录音中」） */
  status?: { label: string; tone: TrainStage };
  children: React.ReactNode;
}

const STAGE_STYLE: Record<TrainStage, { dot: string; text: string; label: string }> = {
  idle: { dot: 'bg-slate-500', text: 'text-slate-300', label: '待开始' },
  training: { dot: 'bg-emerald-400 animate-pulse', text: 'text-emerald-300', label: '训练中' },
  paused: { dot: 'bg-amber-400', text: 'text-amber-300', label: '已暂停' },
  done: { dot: 'bg-sky-400', text: 'text-sky-300', label: '已结束' },
};

/**
 * 训练态外壳：模拟同传箱的沉浸式工作界面。
 * 顶栏放「状态 + 时间 + 变速」，底栏放大号传输控制，
 * 中间主区留给稿件 / 幻灯片 / 画面，右侧是可折叠的战术面板。
 * 训练时视线只在上方稿件和下方按钮之间移动，避免在多层卡片里找按钮。
 */
export function TrainShell({
  mode,
  materialTitle,
  stage,
  time,
  duration,
  recorded = 0,
  rate,
  onRate,
  onStart,
  onPause,
  onResume,
  onFinish,
  onExit,
  busy,
  extras,
  rail,
  railTitle = '战术面板',
  hint,
  footer,
  status,
  children,
}: Props) {
  const [railOpen, setRailOpen] = useState(true);
  const st = STAGE_STYLE[status?.tone ?? stage];

  // 训练中防止误触返回：离开前提示（浏览器层面只拦关闭标签页）
  useEffect(() => {
    if (stage !== 'training') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [stage]);

  const pct = duration > 0 ? Math.min(100, Math.max(0, (time / duration) * 100)) : 0;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-slate-950 text-slate-100">
      {/* 顶栏 */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-slate-900/90 px-3">
        <button
          onClick={onExit}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          title="返回素材页"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300">
            {MODE_LABEL[mode]}
          </span>
          <span className="min-w-0 truncate text-sm font-medium">{materialTitle}</span>
        </div>

        <div className="ml-2 hidden items-center gap-1.5 sm:flex">
          <span className={cn('h-1.5 w-1.5 rounded-full', st.dot)} />
          <span className={cn('text-[11px]', st.text)}>{status?.label ?? st.label}</span>
        </div>

        <div className="mx-auto flex items-center gap-3">
          <div className="flex items-baseline gap-1 font-mono tabular-nums">
            <span className="text-xl font-semibold leading-none">{fmtClock(time)}</span>
            <span className="text-[11px] text-slate-500">/ {fmtSec(duration)}</span>
          </div>
          {recorded > 0 ? (
            <div className="flex items-center gap-1 rounded bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300">
              <Mic className="h-3 w-3" />
              <span className="font-mono tabular-nums">{recorded.toFixed(1)}s</span>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <RateSelect value={rate} onChange={onRate} compact />
          {extras}
          {rail ? (
            <button
              onClick={() => setRailOpen((v) => !v)}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
                railOpen ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/10',
              )}
              title={railOpen ? '收起面板' : '展开面板'}
            >
              <Settings2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </header>

      {/* 进度条：细线贴在顶栏下，视线余光可见 */}
      <div className="h-0.5 shrink-0 bg-white/5">
        <div className="h-full bg-emerald-400/70 transition-[width] duration-150" style={{ width: `${pct}%` }} />
      </div>

      {/* 主区 */}
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-hidden p-2 sm:p-3">{children}</main>
        {rail && railOpen ? (
          <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-white/10 bg-slate-900/50 p-3 lg:block">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{railTitle}</span>
              <button
                className="text-slate-500 hover:text-white lg:hidden"
                onClick={() => setRailOpen(false)}
                title="收起"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 [&_.text-muted-foreground]:text-slate-400 [&_.text-xs]:text-slate-300">
              {rail}
            </div>
          </aside>
        ) : null}
      </div>

      {/* 底栏：大号传输控制 */}
      <footer className="flex h-16 shrink-0 items-center gap-3 border-t border-white/10 bg-slate-900/90 px-3">
        {footer ? footer : null}
        {footer ? null : stage === 'idle' ? (
          <button
            onClick={onStart}
            className="flex h-11 items-center gap-2 rounded-lg bg-emerald-500 px-6 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400"
          >
            <Mic className="h-4 w-4" /> 开始训练
          </button>
        ) : stage === 'training' ? (
          <button
            onClick={onPause}
            className="flex h-11 items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-5 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-400/20"
          >
            <Pause className="h-4 w-4" /> 暂停
          </button>
        ) : stage === 'paused' ? (
          <button
            onClick={onResume}
            className="flex h-11 items-center gap-2 rounded-lg bg-emerald-500 px-5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400"
          >
            <Play className="h-4 w-4" /> 继续
          </button>
        ) : null}

        {footer ? null : stage === 'training' || stage === 'paused' ? (
          <button
            onClick={onFinish}
            disabled={busy}
            className="flex h-11 items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-5 text-sm font-semibold text-rose-300 transition-colors hover:bg-rose-500/20 disabled:opacity-50"
          >
            <Square className="h-4 w-4" /> {busy ? '保存中…' : '结束并复盘'}
          </button>
        ) : null}

        <div className="hidden items-center gap-1.5 text-[11px] text-slate-500 md:flex">
          <Timer className="h-3 w-3" />
          空格 开始/暂停
        </div>

        <div className="ml-auto flex items-center gap-3">
          {hint ? <span className="hidden max-w-[46ch] truncate text-[11px] text-slate-500 lg:block">{hint}</span> : null}
        </div>
      </footer>
      <ResourceMonitor forceCompact />
    </div>
  );
}

/** 训练页右侧面板里的分组卡片（深色版 Section） */
export function RailCard({
  title,
  desc,
  children,
  actions,
}: {
  title?: React.ReactNode;
  desc?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      {title ? (
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-slate-200">{title}</h3>
            {desc ? <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{desc}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** 训练页深色小开关 */
export function RailSwitch({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-1 hover:bg-white/5">
      <span className="min-w-0">
        <span className="block text-xs text-slate-200">{label}</span>
        {desc ? <span className="block text-[11px] text-slate-500">{desc}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-emerald-500' : 'bg-white/15',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  );
}
