import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, ChevronsRight, Mic, Pause, Play, RotateCcw, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader, Section } from '@/components/PageHeader';
import { Waveform } from '@/components/Waveform';
import { LevelMeter, NotePad } from '@/components/NotePad';
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
  const player = useSourcePlayer(url, material.trim.start, material.trim.end);
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
  }, [url, material.id]);

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
    } catch (e) {
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
    const t = player.time;
    setMarkers((prev) => [...prev, { id: db.uid(), sessionId: '', t, type, createdAt: Date.now() }]);
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

  return (
    <>
      <PageHeader
        title={`交替传译 · ${material.title}`}
        desc="逐段「听—记—译—录」。空格播放/暂停，Enter 开始录制，Esc 完成本段，R 重播，M 即时标记。"
        actions={
          <>
            <Badge variant="secondary">
              已完成 {done}/{segments.length} 段
            </Badge>
            <Button size="sm" onClick={finish} disabled={saving}>
              结束并进入复盘 <ChevronsRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </>
        }
      />

      <div className="grid gap-4 p-6 lg:grid-cols-4">
        {/* 段列表 */}
        <Section className="lg:col-span-1" title="分段列表" desc={`共 ${segments.length} 段`}>
          <div className="max-h-[70vh] space-y-1 overflow-y-auto pr-1">
            {segments.map((s, i) => (
              <button
                key={s.index}
                onClick={() => {
                  setIdx(i);
                  player.pause();
                  setStage('ready');
                }}
                className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                  i === idx ? 'border-primary bg-primary/5' : 'hover:bg-accent'
                }`}
              >
                <span className="w-6 tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="flex-1 tabular-nums">{(s.end - s.start).toFixed(1)}s</span>
                {attempts[s.index] ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                ) : s.flag ? (
                  <Badge variant="outline" className="text-[10px] text-amber-600">
                    待调整
                  </Badge>
                ) : null}
              </button>
            ))}
            {!segments.length ? <p className="text-xs text-muted-foreground">正在分析分段…</p> : null}
          </div>
        </Section>

        {/* 主训练区 */}
        <div className="space-y-4 lg:col-span-3">
          <Section
            title={seg ? `第 ${idx + 1} 段 · ${fmtSec(seg.start)} – ${fmtSec(seg.end)}` : '准备中'}
            desc={seg?.text || '播放源语 → 记笔记 → 开始口译录制 → 完成本段'}
            actions={
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">变速</Label>
                <Select value={String(player.rate)} onValueChange={(v) => player.setRate(Number(v))}>
                  <SelectTrigger className="h-8 w-[76px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[0.75, 1, 1.25, 1.5].map((r) => (
                      <SelectItem key={r} value={String(r)}>
                        {r}×
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            }
          >
            <div className="rounded-md bg-muted/40 p-2">
              <Waveform
                peaks={material.peaks}
                duration={material.duration}
                height={104}
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

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => (player.playing ? player.pause() : playSegment())}>
                {player.playing ? <Pause className="mr-1 h-3.5 w-3.5" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                {player.playing ? '暂停' : '播放本段'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => playSegment()}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> 重播
              </Button>
              {stage === 'recording' ? (
                <Button size="sm" variant="destructive" onClick={finishSegment}>
                  <Square className="mr-1 h-3.5 w-3.5" /> 完成本段（{recTime.toFixed(1)}s）
                </Button>
              ) : (
                <Button size="sm" onClick={startRecording} disabled={!seg}>
                  <Mic className="mr-1 h-3.5 w-3.5" /> 开始口译录制
                </Button>
              )}
              <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                <Label>倒计时</Label>
                <Input
                  type="number"
                  className="h-7 w-14"
                  value={countdown}
                  min={0}
                  max={10}
                  onChange={(e) => setCountdown(Number(e.target.value))}
                />
                <span>秒</span>
              </div>
            </div>

            {cdLeft != null ? (
              <div className="mt-3 flex h-16 items-center justify-center rounded-md bg-primary/10 text-2xl font-bold text-primary">
                {cdLeft}
              </div>
            ) : null}

            {stage === 'recording' ? (
              <div className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-50 p-2">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 font-medium text-emerald-700">
                    <Mic className="h-3.5 w-3.5 animate-pulse" /> 正在录制译语
                  </span>
                  <span className="tabular-nums text-emerald-700">{recTime.toFixed(1)}s</span>
                </div>
                <LevelMeter wave={level.wave} level={level.rms} />
              </div>
            ) : null}

            {/* 本段录音回听 */}
            {attempts[seg?.index ?? -1] ? (
              <AttemptPlayback attempt={attempts[seg.index]} />
            ) : null}
          </Section>

          <Section
            title="数字笔记板"
            desc="播放源语时可手写记录关键词；复盘时可逐笔重现，还原「听到什么—记了什么—译出什么」。"
            actions={
              <div className="flex items-center gap-2">
                <Label className="text-xs">启用</Label>
                <Switch checked={noteOn} onCheckedChange={setNoteOn} />
              </div>
            }
          >
            {noteOn ? (
              <div className="space-y-2">
                <NotePad
                  strokes={strokes[seg?.index ?? -1] || []}
                  startedAt={noteStart}
                  onStroke={(s) => {
                    if (seg == null) return;
                    setStrokes((prev) => ({ ...prev, [seg.index]: [...(prev[seg.index] || []), s] }));
                  }}
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => seg != null && setStrokes((prev) => ({ ...prev, [seg.index]: [] }))}
                  >
                    清空本段笔记
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    已记录 {(strokes[seg?.index ?? -1] || []).length} 笔
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">打开开关后可在训练中记录笔记。</p>
            )}
          </Section>
        </div>
      </div>
    </>
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
    <div className="mt-3 rounded-md border bg-card p-2">
      <div className="mb-1 text-xs text-muted-foreground">
        本段译语录音 · {attempt.duration.toFixed(1)}s
      </div>
      <Waveform peaks={attempt.peaks} duration={attempt.duration} height={44} color="#34d399" />
      {url ? <audio src={url} controls className="mt-1 h-8 w-full" /> : null}
    </div>
  );
}
