import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Activity, Trash2, X } from 'lucide-react';
import { fmtBytes, runCleanup, useResources, type CleanupResult } from '@/lib/perf';
import { cn } from '@/lib/utils';

/**
 * 左下角常驻资源监视器：内存 / 存储 / 缓存 / DOM。
 * 颜色只在真正需要关注时变红，避免长期干扰；
 * 一键清理会释放 objectURL、图片缓存、VAD 缓存并清掉孤儿音频。
 */
export function ResourceMonitor({ forceCompact }: { forceCompact?: boolean } = {}) {
  const { snap, busy, setBusy } = useResources(2500);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<CleanupResult | null>(null);
  const loc = useLocation();
  // 训练页底部是主控制区，监视器收成小球贴右下角
  const compact = forceCompact ?? loc.pathname.startsWith('/train');
  /** 训练页是深色界面，监视器也跟着换配色，避免一块白斑 */
  const dark = !!forceCompact;

  const heapPct = snap.heapPct ?? 0;
  const storagePct = snap.storageQuota ? snap.storageUsed / snap.storageQuota : 0;
  const level = heapPct > 0.8 || storagePct > 0.85 ? 'danger' : heapPct > 0.62 || storagePct > 0.7 ? 'warn' : 'ok';
  const dot =
    level === 'danger' ? 'bg-rose-500' : level === 'warn' ? 'bg-amber-400' : 'bg-emerald-500';

  const cleanup = async () => {
    setBusy(true);
    try {
      const r = await runCleanup();
      setResult(r);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'fixed z-40 flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] shadow-sm backdrop-blur transition-colors',
          dark
            ? 'border-white/10 bg-slate-900/90 text-slate-300 hover:bg-slate-800'
            : 'bg-background/95 hover:bg-accent',
          compact ? 'bottom-20 right-3' : 'bottom-4 left-4',
        )}
        title="资源占用（点击查看详情）"
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
        <Activity className="h-3 w-3 text-muted-foreground" />
        <span className="tabular-nums">
          {snap.heapLimit ? `${(snap.heapUsed / 1024 / 1024).toFixed(0)} MB` : '内存 —'}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="tabular-nums">{fmtBytes(snap.storageUsed)}</span>
      </button>
    );
  }

  const bar = (pct: number, tone: string) => (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full rounded-full transition-[width]', tone)} style={{ width: `${Math.min(100, pct * 100)}%` }} />
    </div>
  );

  return (
    <div
      className={cn(
        'fixed z-40 w-[280px] rounded-lg border p-3 text-xs shadow-lg backdrop-blur',
        dark ? 'border-white/10 bg-slate-900/97 text-slate-200' : 'bg-background/97',
        compact ? 'bottom-20 right-3' : 'bottom-4 left-4',
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-medium">
          <span className={cn('h-1.5 w-1.5 rounded-full', dot)} /> 资源占用
        </span>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-2">
        <div>
          <div className="mb-1 flex justify-between text-[11px]">
            <span className="text-muted-foreground">JS 内存</span>
            <span className="tabular-nums">
              {snap.heapLimit ? `${(snap.heapUsed / 1024 / 1024).toFixed(0)} / ${(snap.heapLimit / 1024 / 1024).toFixed(0)} MB` : '浏览器未提供'}
            </span>
          </div>
          {bar(heapPct, level === 'danger' ? 'bg-rose-500' : level === 'warn' ? 'bg-amber-400' : 'bg-emerald-500')}
        </div>

        <div>
          <div className="mb-1 flex justify-between text-[11px]">
            <span className="text-muted-foreground">站点存储</span>
            <span className="tabular-nums">
              {fmtBytes(snap.storageUsed)}
              {snap.storageQuota ? ` / ${fmtBytes(snap.storageQuota)}` : ''}
            </span>
          </div>
          {bar(storagePct, storagePct > 0.85 ? 'bg-rose-500' : 'bg-sky-500')}
        </div>

        <div className="grid grid-cols-2 gap-1 pt-1 text-[11px] text-muted-foreground">
          <span>音视频 {snap.audioCount} 个</span>
          <span className="text-right">{fmtBytes(snap.audioBytes)}</span>
          <span>URL 缓存</span>
          <span className="text-right tabular-nums">{snap.urlCache}</span>
          <span>图片缓存</span>
          <span className="text-right tabular-nums">{snap.imageCache}</span>
          <span>VAD 缓存</span>
          <span className="text-right tabular-nums">{snap.vaCache}</span>
          <span>DOM 节点</span>
          <span className="text-right tabular-nums">{snap.domNodes}</span>
          <span>素材 / 记录</span>
          <span className="text-right tabular-nums">
            {snap.materials} / {snap.sessions}
          </span>
        </div>

        <button
          onClick={cleanup}
          disabled={busy}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border py-1.5 text-[11px] transition-colors hover:bg-accent disabled:opacity-50"
        >
          <Trash2 className="h-3 w-3" /> {busy ? '清理中…' : '立即清理缓存'}
        </button>

        {result ? (
          <p className="text-[11px] leading-relaxed text-emerald-600">
            已释放 URL {result.freedUrls} · 图片 {result.freedImages} · VAD {result.freedVA}
            {result.sessionKeys ? ` · 分段草稿 ${result.sessionKeys}` : ''}
            {result.orphanRemoved ? ` · 孤儿文件 ${result.orphanRemoved}（${fmtBytes(result.orphanBytes)}）` : ''}
          </p>
        ) : (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            页面变卡或占用过高时点一下；不会删除素材与训练记录。
          </p>
        )}
      </div>
    </div>
  );
}
