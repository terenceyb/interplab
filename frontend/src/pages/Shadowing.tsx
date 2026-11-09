import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EvsBar } from '@/components/ScriptView';
import { LevelMeter } from '@/components/NotePad';
import { Waveform } from '@/components/Waveform';
import { VideoStage } from '@/components/VideoStage';
import { RailCard, TrainShell } from '@/components/train/TrainShell';
import { useApp } from '@/store/useApp';
import { useAudioUrl, useHotkeys } from '@/lib/hooks';
import { buildSession, useSimTraining } from '@/lib/useSimTraining';
import { fmtClock, fmtSec } from '@/lib/metrics';
import type { Material, Session } from '@/types';

export default function Shadowing() {
  const { materialId } = useParams();
  const nav = useNavigate();
  const { materials, saveSession } = useApp();
  const material = materials.find((m) => m.id === materialId);
  if (!material) return <div className="p-6 text-sm text-muted-foreground">素材不存在</div>;
  return <Runner material={material} saveSession={saveSession} nav={nav} />;
}

function Runner({
  material,
  saveSession,
  nav,
}: {
  material: Material;
  saveSession: (s: Session) => Promise<void>;
  nav: (p: string) => void;
}) {
  const url = useAudioUrl(material.audioKey);
  const t = useSimTraining(material, url);
  const [lang, setLang] = useState<'source' | 'target'>('source');
  const [type, setType] = useState<'phoneme' | 'phrase'>('phrase');
  const [evsTarget, setEvsTarget] = useState(2);
  const [samples, setSamples] = useState<{ t: number; lag: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const effDur = Math.max(0, material.trim.end - material.trim.start);

  /** 自报告 EVS 打点：E 记录「此刻滞后明显偏离目标」，1 偏短 / 2 偏长 */
  const beat = (delta: number) => {
    if (t.state !== 'training') return;
    setSamples((prev) => [...prev, { t: t.player.time, lag: evsTarget + delta }]);
  };

  useHotkeys({
    ' ': () => {
      if (t.state === 'training') t.pause();
      else if (t.state === 'paused') t.resume();
      else t.start();
    },
    e: () => beat(0),
    '1': () => beat(-1),
    '2': () => beat(1),
  });

  const finish = async () => {
    setSaving(true);
    const attempt = await t.stop();
    const session = await buildSession(
      material,
      'shadowing',
      attempt,
      { rate: t.player.rate, evsTarget, shadowLang: lang, shadowType: type },
      { evsSamples: samples },
    );
    if (session) {
      await saveSession(session);
      setSaving(false);
      nav(`/review/${session.id}`);
    } else setSaving(false);
  };

  return (
    <TrainShell
      mode="shadowing"
      materialTitle={material.title}
      stage={t.state === 'done' ? 'paused' : t.state}
      time={t.player.time}
      duration={effDur}
      recorded={t.elapsed}
      rate={t.player.rate}
      onRate={t.player.setRate}
      onStart={t.start}
      onPause={t.pause}
      onResume={t.resume}
      onFinish={finish}
      onExit={() => nav(`/material/${material.id}`)}
      busy={saving}
      hint="空格 开始/暂停 · E 打点 · 1 偏短 · 2 偏长"
      extras={
        <div className="hidden items-center gap-1 sm:flex">
          <button
            onClick={() => beat(0)}
            disabled={t.state !== 'training'}
            className="h-8 rounded-md border border-border px-2 text-[11px] text-foreground hover:bg-accent disabled:opacity-40"
          >
            打点 E
          </button>
          <button
            onClick={() => beat(-1)}
            disabled={t.state !== 'training'}
            className="h-8 rounded-md border border-border px-2 text-[11px] text-foreground hover:bg-accent disabled:opacity-40"
          >
            偏短
          </button>
          <button
            onClick={() => beat(1)}
            disabled={t.state !== 'training'}
            className="h-8 rounded-md border border-border px-2 text-[11px] text-foreground hover:bg-accent disabled:opacity-40"
          >
            偏长
          </button>
        </div>
      }
      railTitle="跟述面板"
      rail={
        <>
          <RailCard title="跟述参数">
            <div className="space-y-2">
              <div>
                <Label className="text-[11px] text-muted-foreground">跟述语言</Label>
                <Select value={lang} onValueChange={(v) => setLang(v as any)}>
                  <SelectTrigger className="h-8 border bg-muted/40 text-xs text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="source">源语跟述</SelectItem>
                    <SelectItem value="target">译语跟述</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">跟述类型</Label>
                <Select value={type} onValueChange={(v) => setType(v as any)}>
                  <SelectTrigger className="h-8 border bg-muted/40 text-xs text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="phoneme">音位跟述（几乎同步）</SelectItem>
                    <SelectItem value="phrase">片语跟述（滞后数秒）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">目标 EVS（秒）</Label>
                <Input
                  className="h-8 border bg-muted/40 text-xs text-foreground"
                  type="number"
                  step={0.5}
                  value={evsTarget}
                  onChange={(e) => setEvsTarget(Math.max(0, Number(e.target.value)))}
                />
              </div>
            </div>
          </RailCard>

          <RailCard title="EVS 偏差">
            <EvsBar sourceT={t.player.time} duration={effDur} target={evsTarget} />
            <div className="mt-2 text-[11px] text-muted-foreground/80">
              已打点 <span className="font-mono text-muted-foreground">{samples.length}</span> 次 · 复盘时查看偏差曲线
            </div>
          </RailCard>

          <RailCard title="源语波形">
            <Waveform
              peaks={material.peaks}
              duration={material.duration}
              height={48}
              color="#38bdf8"
              cursor={t.player.time + material.trim.start}
              highlight={{ start: material.trim.start, end: material.trim.end }}
              markers={samples.map((s) => ({ t: s.t + material.trim.start, color: '#0ea5e9' }))}
            />
          </RailCard>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex flex-1 flex-col items-center justify-center gap-5 rounded-xl border border-border bg-muted/20">
          <div className="text-center">
            <div className="font-mono text-6xl font-semibold tabular-nums tracking-tight">
              {fmtClock(t.player.time)}
              <span className="ml-2 text-lg text-muted-foreground/80">/ {fmtSec(effDur)}</span>
            </div>
            <div className="mt-2 text-xs text-muted-foreground/80">
              {lang === 'source' ? '源语跟述' : '译语跟述'} ·{' '}
              {type === 'phoneme' ? '音位跟述' : '片语跟述'} · 译语已录 {t.elapsed.toFixed(1)}s
            </div>
          </div>
          <div className="w-full max-w-xl px-6">
            <EvsBar sourceT={t.player.time} duration={effDur} target={evsTarget} />
          </div>
          {t.state === 'training' ? (
            <div className="w-full max-w-md px-6">
              <LevelMeter wave={t.level.wave} level={t.level.rms} />
            </div>
          ) : null}
        </div>
        {material.kind === 'video' ? (
          <VideoStage el={t.player.el} className="max-h-[30vh] shrink-0 rounded-lg" />
        ) : null}
      </div>
    </TrainShell>
  );
}
