import { useEffect, useMemo, useRef, useState } from 'react';
import { DualPlayer, decodeFile, type VoiceActivityLike } from '@/lib/audio';
import { analyzeVoiceActivity } from '@/lib/vad';
import type { Material } from '@/types';
import { audioUrl } from '@/store/useApp';

/** 素材音频 URL（带缓存） */
export function useAudioUrl(key?: string) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!key) return;
    let alive = true;
    audioUrl(key).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [key]);
  return url;
}

/** 源语播放器（带首尾裁剪的虚拟时间轴） */
export function useSourcePlayer(
  url: string,
  trimStart = 0,
  trimEnd = Infinity,
  kind: 'audio' | 'video' = 'audio',
) {
  const ref = useRef<DualPlayer | null>(null);
  const [el, setEl] = useState<HTMLMediaElement | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!url) return;
    const p = new DualPlayer({
      srcUrl: url,
      kind,
      trimStart,
      trimEnd,
      onTick: (t) => setTime(t),
      onEnd: () => setPlaying(false),
    });
    ref.current = p;
    setEl(p.src);
    const onMeta = () => setDuration(p.duration);
    p.src.addEventListener('loadedmetadata', onMeta);
    return () => {
      p.destroy();
      ref.current = null;
      setEl(null);
    };
  }, [url, trimStart, trimEnd, kind]);

  useEffect(() => {
    ref.current?.setRate(rate);
  }, [rate]);

  return {
    player: ref,
    el,
    time,
    duration,
    playing,
    rate,
    setRate,
    play: async (from?: number, stopAt?: number) => {
      setPlaying(true);
      await ref.current?.play(from, stopAt ?? undefined);
    },
    pause: () => {
      ref.current?.pause();
      setPlaying(false);
    },
    seek: (t: number) => ref.current?.seek(t),
  };
}

/** VAD 结果缓存（避免每次进训练都重算） */
const vaCache = new Map<string, VoiceActivityLike>();

export async function getVA(material: Material): Promise<VoiceActivityLike> {
  const hit = vaCache.get(material.audioKey);
  if (hit) return hit;
  const blob = await fetch(await audioUrl(material.audioKey)).then((r) => r.blob());
  const { buffer } = await decodeFile(blob);
  const va = analyzeVoiceActivity(buffer);
  vaCache.set(material.audioKey, va);
  return va;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** 键盘快捷键绑定 */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const fn = ref.current[e.key.toLowerCase()] || ref.current[e.key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

export function useNow(interval = 1000) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), interval);
    return () => clearInterval(id);
  }, [interval]);
  return t;
}

/** 简易派生记忆化，避免重复重算 */
export function useComputed<T>(fn: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(fn, deps);
}
