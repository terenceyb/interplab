import { useEffect, useRef, useState } from 'react';
import { FileWarning, Loader2 } from 'lucide-react';
import * as db from '@/lib/db';
import { loadScene, type Scene } from '@/lib/slideScene';
import { pdfPageRatio, renderPdfPage } from '@/lib/pdfRender';
import { PptxSlideView } from '@/components/slide/PptxView';
import { cn } from '@/lib/utils';

export type SlideSourceKind = 'pdf' | 'pptx' | 'none';

/** 只有 pptx 家族和 pdf 能做原版式渲染；老 .ppt / .odp 仍走文字版 */
export function slideKindOf(fileName?: string): SlideSourceKind {
  if (!fileName) return 'none';
  if (/\.pdf$/i.test(fileName)) return 'pdf';
  if (/\.(pptx|pptm|ppsx|potx)$/i.test(fileName)) return 'pptx';
  return 'none';
}

/** 取原始文件的 blob（IndexedDB），切素材时自动重取 */
export function useSourceBlob(key?: string): Blob | null {
  const [hit, setHit] = useState<{ key: string; blob: Blob } | null>(null);
  useEffect(() => {
    let alive = true;
    if (!key) return;
    db.getAudio(key)
      .then((b) => alive && b && setHit({ key, blob: b }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key]);
  return hit && hit.key === key ? hit.blob : null;
}

/**
 * 原版式呈现：PDF 画 canvas，PPTX 按 OOXML 场景重排成 DOM。
 * 只渲染当前页，翻页即覆盖，避免一次把几十页都塞进内存。
 */
export function SlideSurface({
  sourceKey,
  kind,
  pageNo,
  index,
  className,
}: {
  sourceKey?: string;
  kind: SlideSourceKind;
  /** PDF 的物理页码 */
  pageNo: number;
  /** 第几页（0 基），PPTX 用 */
  index: number;
  className?: string;
}) {
  const blob = useSourceBlob(sourceKey);
  /** 结果带上来源 key：换素材时用 key 判断是否还是这一份，不必在 effect 里清空状态 */
  const [loaded, setLoaded] = useState<{ key: string; scene: Scene } | null>(null);
  const [erred, setErred] = useState<{ key: string; msg: string } | null>(null);

  useEffect(() => {
    let alive = true;
    if (kind !== 'pptx' || !sourceKey || !blob) return;
    loadScene(sourceKey, blob)
      .then((s) => alive && setLoaded({ key: sourceKey, scene: s }))
      .catch((e) => alive && setErred({ key: sourceKey, msg: String(e?.message || e) }));
    return () => {
      alive = false;
    };
  }, [kind, sourceKey, blob]);

  const scene = loaded && loaded.key === sourceKey ? loaded.scene : null;
  const err = erred && erred.key === sourceKey ? erred.msg : '';

  if (!sourceKey || !blob) {
    return <Center note="正在读取原始文件…" spin />;
  }

  if (kind === 'pdf') {
    return <PdfPage sourceKey={sourceKey} blob={blob} pageNo={pageNo} className={className} />;
  }

  if (kind === 'pptx') {
    if (err) return <Center note={`原版式解析失败，已切到文字版：${err}`} warn />;
    if (!scene) return <Center note="正在还原版式…" spin />;
    return <PptxSlideView scene={scene} index={index} className={className} />;
  }

  return <Center note="这种格式只能按文字呈现" warn />;
}

function Center({ note, spin, warn }: { note: string; spin?: boolean; warn?: boolean }) {
  return (
    <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
      {spin ? <Loader2 className="h-4 w-4 animate-spin" /> : warn ? <FileWarning className="h-4 w-4" /> : null}
      <span className="max-w-md">{note}</span>
    </div>
  );
}

function PdfPage({
  sourceKey,
  blob,
  pageNo,
  className,
}: {
  sourceKey: string;
  blob: Blob;
  pageNo: number;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [ratio, setRatio] = useState(0);
  /** 宽高都装得下才画：模块被压扁时整页缩小，而不是把页脚切掉 */
  const cssW = ratio && box.h ? Math.min(box.w, box.h * ratio) : box.w;
  /** 已画完的「页号@宽度」与失败的标记：用它们推导 loading，避免在 effect 里同步 setState */
  const [drawn, setDrawn] = useState('');
  const [failed, setFailed] = useState('');
  const token = `${sourceKey}|${pageNo}|${cssW}`;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    pdfPageRatio(sourceKey, blob, pageNo)
      .then((r) => alive && setRatio(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sourceKey, blob, pageNo]);

  useEffect(() => {
    if (!cssW) return;
    let alive = true;
    // 拖动改变大小时会连续触发，轻微防抖避免反复解析
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      renderPdfPage(sourceKey, blob, pageNo, canvas, cssW)
        .then(() => alive && setDrawn(token))
        .catch(() => alive && setFailed(token));
    }, 90);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [sourceKey, blob, pageNo, cssW, token]);

  const loading = drawn !== token && failed !== token;
  const error = failed === token;

  return (
    <div
      ref={wrapRef}
      className={cn('relative flex h-full w-full items-center justify-center overflow-hidden rounded bg-muted/40', className)}
    >
      <canvas
        ref={canvasRef}
        className="mx-auto block h-auto rounded bg-white shadow-sm"
        style={{ width: cssW ? `${cssW}px` : '100%' }}
      />
      {loading || error ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 rounded bg-background/60 text-xs text-muted-foreground">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {loading ? '渲染页面…' : '这一页渲染失败'}
        </div>
      ) : null}
    </div>
  );
}
