import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * 视频舞台：把 DualPlayer 内部的 <video> 元素挂到页面上。
 * 播放器只负责解码与时间轴，画面由这里承载，两处共用同一个元素，不存在双份音频。
 */
export function VideoStage({
  el,
  className,
  hidden,
}: {
  el: HTMLMediaElement | null;
  className?: string;
  hidden?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !el || !(el instanceof HTMLVideoElement)) return;
    el.className = 'h-full w-full bg-black object-contain';
    el.controls = false;
    el.tabIndex = -1;
    box.innerHTML = '';
    box.appendChild(el);
    return () => {
      if (el.parentElement === box) box.removeChild(el);
    };
  }, [el]);

  if (hidden) return null;
  return (
    <div
      ref={boxRef}
      className={cn('overflow-hidden rounded-lg border border-border bg-black', className)}
    />
  );
}
