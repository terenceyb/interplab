/**
 * 媒体资源 URL 管理：幻灯片图片 / 音频都走这里，统一做 LRU 回收，
 * 防止大量 objectURL 常驻内存把页面拖死。
 */
import * as db from '@/lib/db';
import { isInlineImage, SLIDE_IMG_PREFIX } from '@/lib/document';

const MAX_IMG = 8;
const imgCache = new Map<string, string>();

/** 幻灯片图片 → 可用 URL（IndexedDB 引用、dataURL、http 都能处理） */
export async function resolveImage(src: string): Promise<string> {
  if (!src) return '';
  if (isInlineImage(src)) return src;
  const key = src.startsWith(SLIDE_IMG_PREFIX) ? src.slice(SLIDE_IMG_PREFIX.length) : src;
  const hit = imgCache.get(key);
  if (hit) {
    // 命中后移到队尾（LRU）
    imgCache.delete(key);
    imgCache.set(key, hit);
    return hit;
  }
  const blob = await db.getAudio(key);
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  imgCache.set(key, url);
  while (imgCache.size > MAX_IMG) {
    const first = imgCache.entries().next();
    if (first.done) break;
    URL.revokeObjectURL(first.value[1]);
    imgCache.delete(first.value[0]);
  }
  return url;
}

/** 释放全部图片 objectURL（资源面板的「立即清理」会调用） */
export function clearImageCache() {
  for (const url of imgCache.values()) URL.revokeObjectURL(url);
  imgCache.clear();
}

export const imageCacheSize = () => imgCache.size;
