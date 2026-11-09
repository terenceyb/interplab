/* eslint-disable @typescript-eslint/no-explicit-any -- pdf.js 无官方 TS 声明，这里的对象结构由库决定 */
/**
 * PDF 页面渲染：把原 PDF 的某一页画进 canvas。
 * 只保留「当前页」一张位图，翻页即覆盖，避免整份 PDF 铺满内存。
 */

let libPromise: Promise<any> | null = null;

async function lib(): Promise<any> {
  if (!libPromise) {
    libPromise = (async () => {
      const mod: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const worker: any = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
      mod.GlobalWorkerOptions.workerSrc = worker.default;
      return mod;
    })();
  }
  return libPromise;
}

const docCache = new Map<string, Promise<any>>();

/** 同一份 PDF 只解析一次；缓存上限 2 份，切素材时自动淘汰 */
async function getDoc(key: string, blob: Blob): Promise<any> {
  const hit = docCache.get(key);
  if (hit) return hit;
  if (docCache.size >= 2) {
    const [oldKey, old] = docCache.entries().next().value as [string, Promise<any>];
    docCache.delete(oldKey);
    old.then((d) => d?.destroy?.()).catch(() => undefined);
  }
  const p = (async () => {
    const mod = await lib();
    const base = (import.meta.env.BASE_URL || './').replace(/\/$/, '');
    return mod.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
      cMapUrl: `${base}/pdfjs/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${base}/pdfjs/standard_fonts/`,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
  })();
  docCache.set(key, p);
  return p;
}

/** 页面宽高比（宽 / 高），用于按容器做等比缩放 */
export async function pdfPageRatio(key: string, blob: Blob, pageNo: number): Promise<number> {
  const doc = await getDoc(key, blob);
  const total = doc.numPages ?? 1;
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), total));
  const vp = page.getViewport({ scale: 1 });
  page.cleanup?.();
  return vp.width / Math.max(1, vp.height);
}

export async function pdfPageCount(key: string, blob: Blob): Promise<number> {
  const doc = await getDoc(key, blob);
  return doc.numPages ?? 0;
}

/** 渲染一页到 canvas，返回 CSS 像素尺寸 */
export async function renderPdfPage(
  key: string,
  blob: Blob,
  pageNo: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
): Promise<{ w: number; h: number }> {
  const doc = await getDoc(key, blob);
  const total = doc.numPages ?? 1;
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), total));
  const base = page.getViewport({ scale: 1 });
  const scale = Math.max(0.15, Math.min(4, cssWidth / Math.max(1, base.width)));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const viewport = page.getViewport({ scale });

  canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
  canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
  canvas.style.height = 'auto';

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return { w: viewport.width, h: viewport.height };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  page.cleanup?.();
  return { w: viewport.width, h: viewport.height };
}

export function clearPdfCache() {
  for (const p of docCache.values()) p.then((d) => d?.destroy?.()).catch(() => undefined);
  docCache.clear();
}
