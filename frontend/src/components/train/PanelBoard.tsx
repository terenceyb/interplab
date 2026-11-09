import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, GripHorizontal, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PanelSpec {
  id: string;
  title: string;
  icon?: React.ReactNode;
  /** 标题右侧的小角标（页码、句数等） */
  badge?: React.ReactNode;
  content: React.ReactNode;
  /** 最小尺寸（像素），防止缩到看不见 */
  minW?: number;
  minH?: number;
}

/** 相对容器的比例坐标，0~1 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Slot extends Rect {
  collapsed?: boolean;
}

type Layout = Record<string, Slot>;

const COLLAPSED_H = 34;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 拖动时的磁吸：靠近其他模块边缘或画布边缘 8px 内自动对齐，摆出来的版面才整齐 */
function snap(v: number, size: number, axis: 'x' | 'y', others: Rect[], tol: number): number {
  const cands = [0, 1 - size];
  for (const o of others) {
    const start = axis === 'x' ? o.x : o.y;
    const len = axis === 'x' ? o.w : o.h;
    cands.push(start, start + len, start - size, start + len - size);
  }
  let best = v;
  let bestD = tol;
  for (const c of cands) {
    const d = Math.abs(c - v);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function clampRect(r: Rect, box: { w: number; h: number }, min: { w: number; h: number }): Rect {
  const w = Math.min(1, Math.max(min.w / Math.max(1, box.w), r.w));
  const h = Math.min(1, Math.max(min.h / Math.max(1, box.h), r.h));
  return { w, h, x: Math.min(clamp01(r.x), 1 - w), y: Math.min(clamp01(r.y), 1 - h) };
}

function readLayout(key: string): Layout {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? (parsed as Layout) : {};
  } catch {
    return {};
  }
}

/**
 * 训练主区的自由排布画布。
 *
 * 每个模块都能：拖动标题栏换位置、拖右下角改大小、一键最小化（只留标题条）、
 * 双击标题栏铺满画布，布局按训练模式记在 localStorage，下次进来还是自己那套摆法。
 * 窄屏（<860px）自动退化为纵向堆叠，避免小屏上没法拖。
 */
export function PanelBoard({
  mode,
  panels,
  defaults,
  className,
}: {
  /** 布局存档键，通常用训练模式名 */
  mode: string;
  panels: PanelSpec[];
  /** 每个模块的初始位置（未拖过时使用） */
  defaults: Record<string, Rect>;
  className?: string;
}) {
  const storeKey = `interplab:board:${mode}`;
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 1000, h: 700 });
  const [stored, setStored] = useState<Layout>(() => readLayout(storeKey));
  const [narrow, setNarrow] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [dragging, setDragging] = useState<{ id: string; mode: 'move' | 'size' } | null>(null);
  const dragRef = useRef<{
    id: string;
    mode: 'move' | 'size';
    sx: number;
    sy: number;
    rect: Rect;
    box: { w: number; h: number };
  } | null>(null);

  /* 容器尺寸变化：换算拖拽比例 + 判断是否退化堆叠 */
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
      setNarrow(r.width < 860);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* 只保留当前仍存在的模块，缺失的用默认值补齐 */
  const layout = useMemo<Layout>(() => {
    const next: Layout = {};
    for (const p of panels) {
      const base = defaults[p.id] ?? { x: 0, y: 0, w: 1, h: 1 };
      next[p.id] = { ...base, ...(stored[p.id] ?? {}) };
    }
    return next;
  }, [panels, defaults, stored]);

  const persist = useCallback(
    (next: Layout) => {
      try {
        localStorage.setItem(storeKey, JSON.stringify(next));
      } catch {
        /* 存不下就只在本次会话里生效 */
      }
    },
    [storeKey],
  );

  const update = useCallback(
    (id: string, patch: Partial<Slot>) => {
      setStored((prev) => {
        const merged: Layout = {};
        for (const p of panels) merged[p.id] = { ...layout[p.id], ...(prev[p.id] ?? {}) };
        merged[id] = { ...merged[id], ...patch };
        persist(merged);
        return merged;
      });
    },
    [layout, panels, persist],
  );

  const reset = () => {
    setStored({});
    try {
      localStorage.removeItem(storeKey);
    } catch {
      /* ignore */
    }
  };

  const allCollapsed = panels.every((p) => layout[p.id]?.collapsed);
  const toggleAll = () => {
    const next: Layout = {};
    for (const p of panels) next[p.id] = { ...layout[p.id], collapsed: !allCollapsed };
    setStored(next);
    persist(next);
  };

  const raise = (id: string) => setOrder((prev) => [...prev.filter((x) => x !== id), id]);

  /**
   * 叠放顺序：拉过的模块永远压在上面。
   * 用「已存在顺序 + 剩余模块」拼出完整序列，避免新出现的模块拿到重复的 z-index
   * （否则铺满的幻灯片会被后渲染的稿件模块盖住）。
   */
  const zOrder = useMemo(() => {
    // order 末尾是最后被拉起的模块 → 放在数组最后、z-index 最大
    const known = order.filter((id) => panels.some((p) => p.id === id));
    const list = [...panels.filter((p) => !known.includes(p.id)).map((p) => p.id), ...known];
    // 铺满画布的模块永远压在最上层：否则会被后渲染的模块盖住一半
    const full = (id: string) => {
      const s = layout[id];
      return s && s.x === 0 && s.y === 0 && s.w >= 0.999 && s.h >= 0.999 ? 1 : 0;
    };
    return list.sort((a, b) => full(a) - full(b));
  }, [order, panels, layout]);

  /** 拖动 / 缩放开始 */
  const begin = (e: React.PointerEvent, id: string, mode: 'move' | 'size') => {
    if (narrow || e.button !== 0) return;
    const slot = layout[id];
    if (!slot) return;
    if (mode === 'size' && slot.collapsed) return;
    // 注意：这里不能 preventDefault，否则浏览器不再派发 dblclick，双击铺满就失灵
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id, mode, sx: e.clientX, sy: e.clientY, rect: { ...slot }, box: { ...box } };
    setDragging({ id, mode });
    raise(id);
  };

  const move = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.box.w;
    const dy = (e.clientY - d.sy) / d.box.h;
    const p = panels.find((x) => x.id === d.id);
    const min = { w: p?.minW ?? 240, h: p?.minH ?? 140 };
    const next: Rect =
      d.mode === 'move'
        ? { ...d.rect, x: d.rect.x + dx, y: d.rect.y + dy }
        : { ...d.rect, w: d.rect.w + dx, h: d.rect.h + dy };
    let c = clampRect(next, d.box, min);
    if (d.mode === 'move') {
      const others = panels.filter((p) => p.id !== d.id).map((p) => layout[p.id]).filter(Boolean) as Rect[];
      c = {
        ...c,
        x: snap(c.x, c.w, 'x', others, 8 / Math.max(1, d.box.w)),
        y: snap(c.y, c.h, 'y', others, 8 / Math.max(1, d.box.h)),
      };
      c = clampRect(c, d.box, min);
    }
    update(d.id, c);
  };

  const end = (e: React.PointerEvent) => {
    if (dragRef.current) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* 已经释放过 */
      }
    }
    dragRef.current = null;
    setDragging(null);
  };

  /** 双击铺满：短时间内重复触发（连着两下 dblclick）只算一次 */
  const lastFull = useRef(0);
  const focusFull = (id: string, stamp: number) => {
    if (stamp - lastFull.current < 400) return;
    lastFull.current = stamp;
    const slot = layout[id];
    if (!slot) return;
    const isFull = slot.x === 0 && slot.y === 0 && slot.w === 1 && slot.h === 1;
    update(id, isFull ? (defaults[id] ?? { x: 0, y: 0, w: 1, h: 1 }) : { x: 0, y: 0, w: 1, h: 1 });
    raise(id);
  };

  return (
    <div ref={boxRef} className={cn('relative h-full min-h-0 w-full', className)}>
      {narrow ? (
        <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto pr-0.5">
          {panels.map((p) => (
            <PanelFrame
              key={p.id}
              panel={p}
              collapsed={!!layout[p.id]?.collapsed}
              narrow
              onToggle={() => update(p.id, { collapsed: !layout[p.id]?.collapsed })}
            />
          ))}
        </div>
      ) : (
        <>
          {panels.map((p) => {
            const slot = layout[p.id] ?? { x: 0, y: 0, w: 1, h: 1 };
            const z = dragging?.id === p.id ? 90 : 10 + Math.max(0, zOrder.indexOf(p.id));
            return (
              <div
                key={p.id}
                className={cn(
                  'absolute flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm',
                  dragging?.id === p.id && 'shadow-lg ring-1 ring-primary/30',
                  slot.collapsed && 'shadow-none',
                )}
                style={{
                  left: `${slot.x * 100}%`,
                  top: `${slot.y * 100}%`,
                  width: `${slot.w * 100}%`,
                  height: slot.collapsed ? COLLAPSED_H : `${slot.h * 100}%`,
                  zIndex: z,
                }}
                onPointerDown={() => raise(p.id)}
              >
                <div
                  onPointerDown={(e) => begin(e, p.id, 'move')}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  onDoubleClick={(e) => focusFull(p.id, e.timeStamp)}
                  className={cn(
                    'flex h-[34px] shrink-0 touch-none select-none items-center gap-1.5 border-b bg-muted/40 px-2',
                    dragging?.id === p.id && dragging.mode === 'move' ? 'cursor-grabbing' : 'cursor-grab',
                  )}
                  title="拖动换位置 · 双击铺满"
                >
                  <GripHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                  {p.icon ? <span className="shrink-0 text-muted-foreground">{p.icon}</span> : null}
                  <span className="min-w-0 truncate text-[11px] font-medium">{p.title}</span>
                  {p.badge ? <span className="shrink-0 text-[10px] text-muted-foreground">{p.badge}</span> : null}
                  <span className="ml-auto flex shrink-0 items-center gap-0.5">
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => update(p.id, { collapsed: !slot.collapsed })}
                      className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      title={slot.collapsed ? '展开' : '最小化'}
                    >
                      {slot.collapsed ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
                    </button>
                  </span>
                </div>

                {slot.collapsed ? null : <div className="min-h-0 flex-1 overflow-hidden">{p.content}</div>}

                {slot.collapsed ? null : (
                  <div
                    onPointerDown={(e) => begin(e, p.id, 'size')}
                    onPointerMove={move}
                    onPointerUp={end}
                    onPointerCancel={end}
                    className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize touch-none"
                    title="拖动改变大小"
                  >
                    <svg viewBox="0 0 16 16" className="h-4 w-4 text-muted-foreground/50">
                      <path d="M15 6 L6 15 M15 11 L11 15" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}

          {/* 布局工具：左下角浮起，不占主区空间 */}
          <div className="absolute bottom-1 left-1 z-50 flex items-center gap-1 rounded-full border bg-card/90 px-1.5 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
            <span className="px-1">拖动标题栏换位置 · 右下角改大小</span>
            <button
              onClick={toggleAll}
              className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
              title={allCollapsed ? '全部展开' : '全部最小化'}
            >
              {allCollapsed ? <ChevronsUpDown className="h-3 w-3" /> : <ChevronsDownUp className="h-3 w-3" />}
              {allCollapsed ? '展开' : '收起'}
            </button>
            <button
              onClick={reset}
              className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
              title="恢复默认排版"
            >
              <RotateCcw className="h-3 w-3" /> 重置
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** 窄屏堆叠时的简易卡片（无自由排布） */
function PanelFrame({
  panel,
  collapsed,
  onToggle,
}: {
  panel: PanelSpec;
  collapsed: boolean;
  narrow?: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex h-[34px] shrink-0 items-center gap-1.5 border-b bg-muted/40 px-2">
        {panel.icon ? <span className="text-muted-foreground">{panel.icon}</span> : null}
        <span className="min-w-0 truncate text-[11px] font-medium">{panel.title}</span>
        {panel.badge ? <span className="text-[10px] text-muted-foreground">{panel.badge}</span> : null}
        <button
          onClick={onToggle}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          title={collapsed ? '展开' : '最小化'}
        >
          {collapsed ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
        </button>
      </div>
      {collapsed ? null : (
        <div className="min-h-[180px]" style={{ height: panel.minH ?? 320 }}>
          {panel.content}
        </div>
      )}
    </div>
  );
}
