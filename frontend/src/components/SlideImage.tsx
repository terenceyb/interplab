import { useEffect, useState } from 'react';
import { resolveImage } from '@/lib/media';
import { cn } from '@/lib/utils';

/**
 * 幻灯片配图：按需从 IndexedDB 取图并生成 objectURL，卸载时释放。
 * 图片懒加载 + 缓存上限 8 张，避免整份 PPT 的图片常驻内存。
 */
export function SlideImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string>(() => (/^(data:|blob:|https?:)/i.test(src) ? src : ''));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    if (/^(data:|blob:|https?:)/i.test(src)) {
      setUrl(src);
      return () => {
        alive = false;
      };
    }
    setUrl('');
    resolveImage(src)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [src]);

  if (failed) return null;
  if (!url) {
    return <div className={cn('animate-pulse rounded bg-white/10', className)} aria-label={alt} />;
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
