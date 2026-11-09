import { useEffect, useState } from 'react';
import { resolveImage } from '@/lib/media';
import { cn } from '@/lib/utils';

/**
 * 幻灯片配图：按需从 IndexedDB 取图并生成 objectURL，卸载时释放。
 * 图片懒加载 + 缓存上限 8 张，避免整份 PPT 的图片常驻内存。
 */
export function SlideImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const inline = /^(data:|blob:|https?:)/i.test(src);
  /** 结果记上来源 src：换图时自然失效，不必在 effect 里清空状态 */
  const [hit, setHit] = useState<{ src: string; url: string } | null>(null);
  const [broken, setBroken] = useState<string>('');
  const url = inline ? src : hit?.src === src ? hit.url : '';
  const failed = broken === src;

  useEffect(() => {
    if (inline) return;
    let alive = true;
    resolveImage(src)
      .then((u) => {
        if (alive) setHit({ src, url: u });
      })
      .catch(() => alive && setBroken(src));
    return () => {
      alive = false;
    };
  }, [src, inline]);

  if (failed) return null;
  if (!url) {
    return <div className={cn('animate-pulse rounded bg-muted', className)} aria-label={alt} />;
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(src)}
      className={className}
    />
  );
}
