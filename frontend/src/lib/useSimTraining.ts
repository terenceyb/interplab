import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Recorder, micAvailable } from '@/lib/audio';
import { useSourcePlayer } from '@/lib/hooks';
import * as db from '@/lib/db';
import type { Attempt, Material, Session, TrainMode } from '@/types';

/**
 * 同传 / 影子练习通用录制逻辑：
 * 源语与译语双轨同步录制——暂停源语时译语轨同步暂停，恢复时两轨同步继续，
 * 保证 10 分钟连续训练的时间漂移可控（两轨共享时间基准 offset）。
 */
export function useSimTraining(material: Material, url: string) {
  const player = useSourcePlayer(url, material.trim.start, material.trim.end, material.kind ?? 'audio');
  const [state, setState] = useState<'idle' | 'training' | 'paused' | 'done'>('idle');
  const [level, setLevel] = useState({ rms: 0, wave: [] as number[] });
  const [elapsed, setElapsed] = useState(0);
  const [startAt, setStartAt] = useState(0);
  const recRef = useRef<Recorder | null>(null);
  const tickRef = useRef<number>(0);

  useEffect(() => {
    if (state !== 'training') return;
    tickRef.current = window.setInterval(() => setElapsed(recRef.current?.elapsed || 0), 200);
    return () => clearInterval(tickRef.current);
  }, [state]);

  const start = async () => {
    if (!micAvailable()) {
      alert('当前环境不支持录音，请在支持麦克风的浏览器中打开并授予权限。');
      return;
    }
    const rec = new Recorder();
    rec.onLevel = (rms, wave) => setLevel({ rms, wave });
    try {
      await rec.start();
    } catch {
      alert('无法访问麦克风，请检查浏览器权限设置。');
      return;
    }
    recRef.current = rec;
    const from = player.time > 0.2 ? player.time : 0;
    setStartAt(from);
    setState('training');
    await player.play(from);
  };

  const pause = () => {
    player.pause();
    recRef.current?.pause();
    setState('paused');
  };

  const resume = async () => {
    recRef.current?.resume();
    setState('training');
    await player.play();
  };

  const stop = async (): Promise<Attempt | null> => {
    player.pause();
    const rec = recRef.current;
    const res = rec ? await rec.stop() : null;
    recRef.current = null;
    setState('done');
    if (!res) return null;
    const key = await db.putAudio(res.blob);
    const endT = Math.max(startAt, player.time);
    return {
      id: db.uid(),
      sessionId: '',
      audioKey: key,
      duration: res.duration,
      peaks: res.peaks,
      sourceStart: startAt,
      sourceEnd: endT,
      userAudioStart: 0,
      userAudioEnd: res.duration,
      attemptNumber: 1,
      createdAt: Date.now(),
    };
  };

  return { player, state, level, elapsed, startAt, start, pause, resume, stop, setState };
}

export async function buildSession(
  material: Material,
  mode: TrainMode,
  attempt: Attempt | null,
  params: Session['params'],
  extra?: Partial<Session>,
): Promise<Session | null> {
  if (!attempt) return null;
  const n = await db.nextAttemptNumber(material.id, mode);
  const session: Session = {
    id: db.uid(),
    materialId: material.id,
    materialTitle: material.title,
    mode,
    createdAt: Date.now(),
    duration: Math.max(0, attempt.sourceEnd - attempt.sourceStart),
    attemptNumber: n,
    segments: [
      {
        index: 0,
        start: attempt.sourceStart,
        end: attempt.sourceEnd,
        confidence: 1,
        approx: false,
      },
    ],
    attempts: [{ ...attempt, sessionId: '', attemptNumber: n }],
    markers: [],
    params,
    note: '',
    ...extra,
  };
  session.attempts.forEach((a) => (a.sessionId = session.id));
  return session;
}

export function useGoReview() {
  const nav = useNavigate();
  return (id: string) => nav(`/review/${id}`);
}
