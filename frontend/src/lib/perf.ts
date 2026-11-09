/**
 * 资源占用监控与清理。
 * 纯前端应用的「内存泄漏」几乎都来自 objectURL、解码后的 AudioBuffer、
 * 以及常驻的 base64 图片；这里统一观测并提供一键清理。
 */
import { useEffect, useState } from 'react';
import * as db from '@/lib/db';
import { clearImageCache, imageCacheSize } from '@/lib/media';
import { clearVACache, vaCacheSize } from '@/lib/hooks';
import { clearUrlCache, urlCacheSize, useApp } from '@/store/useApp';
import { audioCtx } from '@/lib/audio';
import { SLIDE_IMG_PREFIX } from '@/lib/document';

export interface ResourceSnapshot {
  /** JS 堆已用（字节），浏览器不支持时为 0 */
  heapUsed: number;
  heapLimit: number;
  /** 堆使用率 0-1，null 表示浏览器不提供 */
  heapPct: number | null;
  /** 站点存储用量 / 配额（字节） */
  storageUsed: number;
  storageQuota: number;
  /** IndexedDB 中音视频条目数与体积 */
  audioCount: number;
  audioBytes: number;
  /** 缓存计数 */
  urlCache: number;
  imageCache: number;
  vaCache: number;
  domNodes: number;
  /** AudioContext 状态（suspended 表示被浏览器挂起） */
  ctxState: string;
  /** 素材 / 记录数量 */
  materials: number;
  sessions: number;
}

const EMPTY: ResourceSnapshot = {
  heapUsed: 0,
  heapLimit: 0,
  heapPct: null,
  storageUsed: 0,
  storageQuota: 0,
  audioCount: 0,
  audioBytes: 0,
  urlCache: 0,
  imageCache: 0,
  vaCache: 0,
  domNodes: 0,
  ctxState: 'unknown',
  materials: 0,
  sessions: 0,
};

export async function readResources(): Promise<ResourceSnapshot> {
  const mem = (performance as any).memory;
  const heapUsed = mem?.usedJSHeapSize ?? 0;
  const heapLimit = mem?.jsHeapSizeLimit ?? 0;
  let storageUsed = 0;
  let storageQuota = 0;
  try {
    const est = await navigator.storage?.estimate?.();
    storageUsed = est?.usage ?? 0;
    storageQuota = est?.quota ?? 0;
  } catch {
    /* 部分浏览器禁用 */
  }
  let audioCount = 0;
  let audioBytes = 0;
  try {
    const list = await db.listAudioMeta();
    audioCount = list.length;
    audioBytes = list.reduce((s, x) => s + x.size, 0);
  } catch {
    /* ignore */
  }
  const app = useApp.getState();
  return {
    heapUsed,
    heapLimit,
    heapPct: heapLimit ? heapUsed / heapLimit : null,
    storageUsed,
    storageQuota,
    audioCount,
    audioBytes,
    urlCache: urlCacheSize(),
    imageCache: imageCacheSize(),
    vaCache: vaCacheSize(),
    domNodes: typeof document !== 'undefined' ? document.getElementsByTagName('*').length : 0,
    ctxState: (() => {
      try {
        return audioCtx().state;
      } catch {
        return 'unknown';
      }
    })(),
    materials: app.materials.length,
    sessions: app.sessions.length,
  };
}

/** 每 interval 毫秒采样一次（默认 2s，避免自身成为性能负担） */
export function useResources(interval = 2000) {
  const [snap, setSnap] = useState<ResourceSnapshot>(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const s = await readResources();
      if (alive) setSnap(s);
    };
    void tick();
    const id = window.setInterval(tick, interval);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [interval]);

  return { snap, busy, setBusy };
}

/** 清理孤儿音频：DB 里存在但没有任何素材/录音引用的 blob */
export async function pruneOrphanAudio(): Promise<{ removed: number; bytes: number }> {
  const app = useApp.getState();
  const referenced = new Set<string>();
  for (const m of app.materials) {
    if (m.audioKey) referenced.add(m.audioKey);
    for (const s of m.slides || []) {
      for (const img of s.images || []) {
        if (img.startsWith(SLIDE_IMG_PREFIX)) referenced.add(img.slice(SLIDE_IMG_PREFIX.length));
      }
    }
  }
  for (const s of app.sessions) for (const a of s.attempts) if (a.audioKey) referenced.add(a.audioKey);

  const all = await db.listAudioMeta();
  const orphans = all.filter((x) => !referenced.has(x.key));
  if (!orphans.length) return { removed: 0, bytes: 0 };
  await db.deleteAudio(orphans.map((o) => o.key));
  return { removed: orphans.length, bytes: orphans.reduce((s, o) => s + o.size, 0) };
}

export interface CleanupResult {
  freedUrls: number;
  freedImages: number;
  freedVA: number;
  orphanRemoved: number;
  orphanBytes: number;
  sessionKeys: number;
}

/** 一键释放：objectURL、图片缓存、VAD 缓存、分段草稿、孤儿音频 */
export async function runCleanup(): Promise<CleanupResult> {
  const freedUrls = urlCacheSize();
  const freedImages = imageCacheSize();
  const freedVA = vaCacheSize();
  clearUrlCache();
  clearImageCache();
  clearVACache();

  let sessionKeys = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith('segs:') || k.startsWith('startSeg:'))) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
    sessionKeys = keys.length;
  } catch {
    /* 隐私模式可能禁用 */
  }

  const { removed, bytes } = await pruneOrphanAudio();
  return {
    freedUrls,
    freedImages,
    freedVA,
    orphanRemoved: removed,
    orphanBytes: bytes,
    sessionKeys,
  };
}

export const fmtBytes = (b: number) => {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
};
