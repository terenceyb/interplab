import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Mic, Pause, Play, RotateCcw, Square } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Waveform } from '@/components/Waveform';
import { VideoStage } from '@/components/VideoStage';
import { LevelMeter, NotePad } from '@/components/NotePad';
import { RailCard, RailSwitch, TrainShell, type TrainStage } from '@/components/train/TrainShell';
import { useApp } from '@/store/useApp';
import { useAudioUrl, useSourcePlayer, getVA, useHotkeys } from '@/lib/hooks';
import { Recorder, micAvailable } from '@/lib/audio';
import { clipActivity, smartSegment } from '@/lib/vad';
import * as db from '@/lib/db';
import { audioUrl } from '@/store/useApp';
import { fmtSec } from '@/lib/metrics';
import type { Attempt, Material, Marker, Segment, Session, Stroke } from '@/types';

type Stage = 'ready' | 'playing' | 'recording';

export default function Consecutive() {
  const { materialId } = useParams();
  const nav = useNavigate();
  const { materials, saveSession } = useApp();
  const material = materials.find((m) => m.id === materialId);
  const url = useAudioUrl(material?.audioKey);
  if (!material) return <div className="p-6 text-sm text-muted-foreground">素材不存在</div>;
  return <Runner key={material.id} material={material} url={url} saveSession={saveSession} nav={nav} />;
}

function Runner({
  material,
  url,
  saveSession,
  nav,
}: {
  material: Material;
  url: string;
  saveSession: (s: Session) => Promise<void>;
  nav: (p: string) => void;
}) {
  const effDur = Math.max(0, material.trim.end - material.trim.start);
  const player = useSourcePlayer(url, material.trim.start, material.trim.end, material.kind ?? 'audio');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [idx, setIdx] = useState(0);
  const [stage, setStage] = useState<Stage>('ready');
  const [attempts, setAttempts] = useState<Record<number, Attempt>>({});
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [countdown, setCountdown] = useState(3);
  const [cdLeft, setCdLeft] = useState<number | null>(null);
  const [recTime, setRecTime] = useState(0);
  const [level, setLevel] = useState({ rms: 0, wave: [] as number[] });
  const [noteOn, setNoteOn] = useState(false);
  const [strokes, setStrokes] = useState<Record<number, Stroke[]>>({});
  const [noteStart, setNoteStart] = useState(0);
  const [saving, setSaving] = useState(false);
  const recRef = useRef<Recorder | null>(null);
  const timerRef = useRef<number>(0);
  const seg = segments[idx];

  /* 载入分段 */
  useEffect(() => {
    if (!url) return;
    (async () => {
      const cached = sessionStorage.getItem(`segs:${material.id}`);
      if (cached) {
        setSegments(JSON.parse(cached));
        const startIdx = Number(sessionStorage.getItem(`startSeg:${material.id}`) || 0);
        setIdx(startIdx || 0);
        return;
      }
      const va = clipActivity(await getVA(material), material.trim.start, material.trim.end);
      const hints = material.sentences
        .filter((s) => s.confidence >= 0.5)
        .map((s) => ({ start: s.start, end: s.end, confidence: s.confidence }));
      setSegments(smartSegment(va, { target: 60, floatPct: 0.2, minSeg: 15, maxSeg: 120, preference: 'balance' }, hints));
    })();
  }, [url, material]);

  /* 录音计时 */
  useEffect(() => {
    if (stage !== 'recording') return;
    timerRef.current = window.setInterval(() => setRecTime((t) => t + 0.1), 100);
    return () => clearInterval(timerRef.current);
  }, [stage]);

  const playSegment = async (i = idx) => {
    const s = segments[i];
    if (!s) return;
    setStage('playing');
    setNoteStart(performance.now());
    await player.play(s.start, s.end);
  };

  const startRecording = async () => {
    if (!micAvailable()) {
      alert('当前浏览器/环境不支持录音，请在支持麦克风的浏览器中打开，并授予麦克风权限。');
      return;
    }
    if (countdown > 0) {
      setCdLeft(countdown);
      await new Promise<void>((resolve) => {
        const id = setInterval(() => {
          setCdLeft((v) => {
            if (v == null) return v;
            if (v <= 1) {
              clearInterval(id);
              resolve();
              return null;
            }
            return v - 1;
          });
        }, 1000);
      });
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
    setRecTime(0);
    setStage('recording');
  };

  const stopRecording = async () => {
    const rec = recRef.current;
    if (!rec) return;
    const res = await rec.stop();
    recRef.current = null;
    setStage('ready');
    if (!res || !seg) return;
    const key = await db.putAudio(res.blob);
    const attempt: Attempt = {
      id: db.uid(),
      sessionId: '',
      segmentIndex: seg.index,
      audioKey: key,
      duration: res.duration,
      peaks: res.peaks,
      sourceStart: seg.start,
      sourceEnd: seg.end,
      userAudioStart: 0,
      userAudioEnd: res.duration,
      attemptNumber: 1,
      createdAt: Date.now(),
      strokes: strokes[seg.index] || [],
    };
    setAttempts((prev) => ({ ...prev, [seg.index]: attempt }));
    return attempt;
  };

  const finishSegment = async () => {
    await stopRecording();
    player.pause();
    if (idx < segments.length - 1) setIdx(idx + 1);
  };

  const addMarker = (type: string) => {
    setMarkers((prev) => [...prev, { id: db.uid(), sessionId: '', t: player.time, type, createdAt: Date.now() }]);
  };

  useHotkeys(
    {
      ' ': () => (stage === 'recording' ? finishSegment() : player.playing ? player.pause() : playSegment()),
      r: () => playSegment(),
      enter: () => (stage === 'recording' ? finishSegment() : startRecording()),
      escape: () => stage === 'recording' && finishSegment(),
      arrowleft: () => player.seek(Math.max(0, player.time - 5)),
      arrowright: () => player.seek(Math.min(effDur, player.time + 5)),
      m: () => addMarker('omission'),
    },
    true,
  );

  const finish = async () => {
    setSaving(true);
    const list = Object.values(attempts);
    if (!list.length) {
      alert('还没有任何录音，至少完成一段再结束。');
      setSaving(false);
      return;
    }
    const n = await db.nextAttemptNumber(material.id, 'consecutive');
    const session: Session = {
      id: db.uid(),
      materialId: material.id,
      materialTitle: material.title,
      mode: 'consecutive',
      createdAt: Date.now(),
      duration: list.reduce((s, a) => s + (a.sourceEnd - a.sourceStart), 0),
      attemptNumber: n,
      segments,
      attempts: list.map((a) => ({ ...a, sessionId: '', attemptNumber: n })),
      markers: markers.map((m) => ({ ...m, sessionId: '' })),
      params: { countdown, rate: player.rate },
      note: '',
    };
    session.attempts.forEach((a) => (a.sessionId = session.id));
    session.markers.forEach((m) => (m.sessionId = session.id));
    await saveSession(session);
    setSaving(false);
    nav(`/review/${session.id}`);
  };

  const done = Object.keys(attempts).length;
  const stageMap: TrainStage = stage === 'recording' ? 'training' : stage === 'playing' ? 'paused' : 'idle';
  const statusLabel =
    stage === 'recording' ? `录音中 · 第 ${idx + 1} 段` : stage === 'playing' ? '听源语' : '待开始';

  return (
    <TrainShell
      mode="consecutive"
      materialTitle={material.title}
      stage={stageMap}
      status={{ label: statusLabel, tone: stageMap }}
      time={player.time}
      duration={effDur}
      recorded={recTime}
      rate={player.rate}
      onRate={player.setRate}
      onStart={() => (stage === 'recording' ? finishSegment() : startRecording())}
      onPause={() => player.pause()}
      onResume={() => playSegment()}
      onFinish={finish}
      onExit={() => nav(`/material/${material.id}`)}
      busy={saving}
      hint="空格 播放/暂停 · Enter 开始录制 · Esc 完成本段 · R 重播 · M 标记"
      railTitle="分段与笔记"
      footer={
        <>
          <button
            onClick={() => (player.playing ? player.pause() : playSegment())}
            className="flex h-11 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 text-sm font-medium text-slate-100 hover:bg-white/10"
          >
            {player.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {player.playing ? '暂停' : '播放本段'}
          </button>
          <button
            onClick={() => playSegment()}
            className="flex h-11 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 text-sm text-slate-200 hover:bg-white/10"
          >
            <RotateCcw className="h-4 w-4" /> 重播
          </button>
          <div className="flex items-center overflow-hidden rounded-lg border border-white/15">
            <button
              onClick={() => {
                setIdx(Math.max(0, idx - 1));
                player.pause();
                setStage('ready');
              }}
              disabled={idx <= 0}
              className="h-11 px-2.5 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-30"
              title="上一段"
            >
              上一段
            </button>
            <span className="h-5 w-px bg-white/15" />
            <button
              onClick={() => {
                setIdx(Math.min(segments.length - 1, idx + 1));
                player.pause();
                setStage('ready');
              }}
              disabled={idx >= segments.length - 1}
              className="h-11 px-2.5 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-30"
              title="下一段"
            >
              下一段
            </button>
          </div>
          {stage === 'recording' ? (
            <button
              onClick={finishSegment}
              className="flex h-11 items-center gap-2 rounded-lg bg-rose-500 px-5 text-sm font-semibold text-white hover:bg-rose-400"
            >
              <Square className="h-4 w-4" /> 完成本段 {recTime.toFixed(1)}s
            </button>
          ) : (
            <button
              onClick={startRecording}
              disabled={!seg}
              className="flex h-11 items-center gap-2 rounded-lg bg-emerald-500 px-5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
            >
              <Mic className="h-4 w-4" /> 开始口译录制
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="secondary" className="bg-white/10 text-[11px] text-slate-300">
              已完成 {done}/{segments.length} 段
            </Badge>
            <button
              onClick={finish}
              disabled={saving}
              className="h-9 rounded-lg border border-white/15 px-3 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50"
            >
              结束并复盘
            </button>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <Label className="text-[11px] text-slate-500">倒计时</Label>
              <Input
                type="number"
                className="h-7 w-14 border-white/15 bg-white/5 text-xs text-slate-100"
                value={countdown}
                min={0}
                max={10}
                onChange={(e) => setCountdown(Number(e.target.value))}
              />
            </div>
          </div>
        </>
      }
      rail={
        <>
          <RailCard title={`分段列表 · 共 ${segments.length} 段`} desc="点击切换；绿色勾表示已录">
            <div className="max-h-[46vh] space-y-1 overflow-y-auto pr-1">
              {segments.map((s, i) => (
                <button
                  key={s.index}
                  onClick={() => {
                    setIdx(i);
                    player.pause();
                    setStage('ready');
                  }}
                  className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors ${
                    i === idx
                      ? 'border-sky-400/60 bg-sky-400/10 text-white'
                      : 'border-white/10 text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <span className="w-5 tabular-nums text-slate-500">{i + 1}</span>
                  <span className="flex-1 tabular-nums">{(s.end - s.start).toFixed(1)}s</span>
                  {attempts[s.index] ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : s.flag ? (
                    <span className="text-[10px] text-amber-400">待调整</span>
                  ) : null}
                </button>
              ))}
              {!segments.length ? <p className="text-[11px] text-slate-500">正在分析分段…</p> : null}
            </div>
          </RailCard>

          <RailCard title="笔记板">
            <RailSwitch
              label="启用数字笔记"
              desc="播放源语时手写关键词"
              checked={noteOn}
              onChange={setNoteOn}
            />
            {noteOn ? (
              <button
                className="mt-2 w-full rounded border border-white/15 py-1 text-[11px] text-slate-300 hover:bg-white/10"
                onClick={() => seg != null && setStrokes((prev) => ({ ...prev, [seg.index]: [] }))}
              >
                清空本段笔记（{(strokes[seg?.index ?? -1] || []).length} 笔）
              </button>
            ) : null}
          </RailCard>

          <RailCard title="快捷键">
            <div className="space-y-0.5 text-[11px] text-slate-400">
              {[
                ['Space', '播放 / 暂停 / 完成本段'],
                ['Enter', '开始录制'],
                ['Esc', '完成本段'],
                ['R', '重播本段'],
                ['M', '即时标记'],
                ['← / →', '前后 5 秒'],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="w-14 shrink-0 rounded bg-white/10 px-1 text-center font-mono text-[10px] text-slate-300">
                    {k}
                  </span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </RailCard>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto">
        {/* 当前段信息 */}
        <div className="shrink-0 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300">
              第 {idx + 1} / {segments.length} 段
            </span>
            <span className="font-mono text-sm tabular-nums text-slate-300">
              {seg ? `${fmtSec(seg.start)} – ${fmtSec(seg.end)}` : '—'}
            </span>
            <span className="text-xs text-slate-500">{seg ? `${(seg.end - seg.start).toFixed(1)}s` : ''}</span>
            {attempts[seg?.index ?? -1] ? (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">本段已录</span>
            ) : null}
            <span className="ml-auto text-[11px] text-slate-500">
              {stage === 'recording' ? '正在录制 · Esc 完成本段' : '播放源语 → 记笔记 → 录音 → 完成本段'}
            </span>
          </div>
          <p className={`mt-2 text-sm leading-relaxed ${seg?.text ? 'text-slate-300' : 'text-slate-500'}`}>
            {seg?.text || '本段暂无对齐文本（未导入稿件时按语音停顿切分，不影响训练）'}
          </p>
        </div>

        {material.kind === 'video' ? (
          <VideoStage el={player.el} className="max-h-[38vh] shrink-0 rounded-lg" />
        ) : null}

        {/* 波形 */}
        <div className="shrink-0 rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <Waveform
            peaks={material.peaks}
            duration={material.duration}
            height={110}
            color="#38bdf8"
            cursor={player.time + material.trim.start}
            highlight={seg ? { start: seg.start + material.trim.start, end: seg.end + material.trim.start } : undefined}
            regions={segments.map((s) => ({
              start: s.start + material.trim.start,
              end: s.end + material.trim.start,
              label: `#${s.index + 1}`,
            }))}
            onSeek={(t) => player.seek(Math.max(0, t - material.trim.start))}
            markers={markers.map((m) => ({ t: m.t + material.trim.start, color: '#f97316' }))}
          />
        </div>

        {/* 录音状态 */}
        {stage === 'recording' ? (
          <div className="shrink-0 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2">
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1 font-medium text-rose-300">
                <Mic className="h-3 w-3 animate-pulse" /> 正在录制译语
              </span>
              <span className="font-mono tabular-nums text-rose-300">{recTime.toFixed(1)}s</span>
            </div>
            <LevelMeter wave={level.wave} level={level.rms} />
          </div>
        ) : null}

        {cdLeft != null ? (
          <div className="flex h-14 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-2xl font-bold text-emerald-300">
            {cdLeft}
          </div>
        ) : null}

        {/* 笔记板 */}
        {noteOn ? (
          <div className="min-h-[220px] flex-1 rounded-lg border border-white/10 bg-white p-2">
            <NotePad
              strokes={strokes[seg?.index ?? -1] || []}
              startedAt={noteStart}
              onStroke={(s) => {
                if (seg == null) return;
                setStrokes((prev) => ({ ...prev, [seg.index]: [...(prev[seg.index] || []), s] }));
              }}
            />
          </div>
        ) : null}

        {/* 本段录音回听 */}
        {attempts[seg?.index ?? -1] ? <AttemptPlayback attempt={attempts[seg.index]} /> : null}
      </div>
    </TrainShell>
  );
}

function AttemptPlayback({ attempt }: { attempt: Attempt }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true;
    audioUrl(attempt.audioKey).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [attempt.audioKey]);
  return (
    <div className="shrink-0 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
      <div className="mb-1 text-[11px] text-slate-400">本段译语录音 · {attempt.duration.toFixed(1)}s</div>
      <Waveform peaks={attempt.peaks} duration={attempt.duration} height={40} color="#34d399" />
      {url ? <audio src={url} controls className="mt-1 h-8 w-full" /> : null}
    </div>
  );
}
