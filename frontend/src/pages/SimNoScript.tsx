import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Timer } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EvsBar } from '@/components/ScriptView';
import { SlideDeck } from '@/components/SlideDeck';
import { DocSlots } from '@/components/train/DocSlots';
import { RailCard, RailSwitch, TrainShell } from '@/components/train/TrainShell';
import { LevelMeter } from '@/components/NotePad';
import { Waveform } from '@/components/Waveform';
import { VideoStage } from '@/components/VideoStage';
import { useApp } from '@/store/useApp';
import { useAudioUrl, useHotkeys } from '@/lib/hooks';
import { buildSession, useSimTraining } from '@/lib/useSimTraining';
import { fmtClock, fmtSec } from '@/lib/metrics';
import * as db from '@/lib/db';
import type { Material, Marker, Session } from '@/types';

export default function SimNoScript() {
  const { materialId } = useParams();
  const nav = useNavigate();
  const { materials, saveSession, saveMaterial } = useApp();
  const material = materials.find((m) => m.id === materialId);
  if (!material) return <div className="p-6 text-sm text-muted-foreground">素材不存在</div>;
  return <Runner material={material} saveSession={saveSession} saveMaterial={saveMaterial} nav={nav} />;
}

function Runner({
  material,
  saveSession,
  saveMaterial,
  nav,
}: {
  material: Material;
  saveSession: (s: Session) => Promise<void>;
  saveMaterial: (m: Material) => Promise<void>;
  nav: (p: string) => void;
}) {
  const url = useAudioUrl(material.audioKey);
  const t = useSimTraining(material, url);
  const [evsTarget, setEvsTarget] = useState(2.5);
  const [noise, setNoise] = useState(false);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [saving, setSaving] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [fontSize, setFontSize] = useState(20);
  const effDur = Math.max(0, material.trim.end - material.trim.start);
  const hasSlides = !!material.slides?.length;

  const mark = (type: 'evs-short' | 'evs-long') => {
    setMarkers((prev) => [...prev, { id: db.uid(), sessionId: '', t: t.player.time, type, createdAt: Date.now() }]);
  };

  useHotkeys({
    ' ': () => {
      if (t.state === 'training') t.pause();
      else if (t.state === 'paused') t.resume();
      else t.start();
    },
    b: () => t.state === 'training' && mark('evs-short'),
    n: () => t.state === 'training' && mark('evs-long'),
  });

  const finish = async () => {
    setSaving(true);
    const attempt = await t.stop();
    const session = await buildSession(material, 'sim-noscript', attempt, {
      rate: t.player.rate,
      evsTarget,
      noise,
    });
    if (session) {
      session.markers = markers.map((m) => ({ ...m, sessionId: session.id }));
      await saveSession(session);
      setSaving(false);
      nav(`/review/${session.id}`);
    } else setSaving(false);
  };

  return (
    <TrainShell
      mode="sim-noscript"
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
      hint="空格 开始/暂停 · B 跟得太紧 · N 跟得太松 · ← / → 翻页"
      extras={
        <div className="hidden items-center gap-1 sm:flex">
          <button
            onClick={() => mark('evs-short')}
            disabled={t.state !== 'training'}
            className="h-8 rounded-md border border-white/15 px-2 text-[11px] text-slate-200 hover:bg-white/10 disabled:opacity-40"
          >
            太紧 B
          </button>
          <button
            onClick={() => mark('evs-long')}
            disabled={t.state !== 'training'}
            className="h-8 rounded-md border border-white/15 px-2 text-[11px] text-slate-200 hover:bg-white/10 disabled:opacity-40"
          >
            太松 N
          </button>
        </div>
      }
      railTitle="无稿同传面板"
      rail={
        <>
          <RailCard title="EVS 目标" desc="目标滞后时间，决定你跟读的安全距离">
            <div className="flex items-center gap-2">
              <Input
                className="h-8 border-white/15 bg-white/5 text-xs text-slate-100"
                type="number"
                step={0.5}
                value={evsTarget}
                onChange={(e) => setEvsTarget(Math.max(0.5, Number(e.target.value)))}
              />
              <span className="text-[11px] text-slate-400">秒</span>
            </div>
            <div className="mt-2">
              <EvsBar dark sourceT={t.player.time} duration={effDur} target={evsTarget} />
            </div>
          </RailCard>

          <RailCard title="看屏材料（可选）" desc="真实会议里译员能看到大屏；PPT 仅作参考，不影响无稿训练">
            <DocSlots
              dark
              only="slides"
              slideCount={material.slides?.length}
              slidesFile={material.slidesFile}
              slidesSource={material.slidesSource}
              onSlides={async (doc, fileName) => {
                if (!doc) return saveMaterial({ ...material, slides: undefined, slidesFile: undefined, slidesSource: undefined });
                await saveMaterial({
                  ...material,
                  slides: doc.slides,
                  slidesFile: fileName,
                  slidesSource: doc.source,
                  docKind: 'slides',
                });
                setSlideIndex(0);
              }}
              onScript={() => undefined}
            />
            {hasSlides ? (
              <div className="mt-2">
                <Label className="text-[11px] text-slate-400">字号 {fontSize}px</Label>
                <input
                  type="range"
                  min={14}
                  max={32}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-full accent-sky-400"
                />
              </div>
            ) : null}
          </RailCard>

          <RailCard title="训练参数">
            <RailSwitch label="干扰音" desc="低音量背景噪声" checked={noise} onChange={setNoise} />
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
              <Timer className="h-3 w-3" /> 本轮标记 {markers.length} 个
            </div>
          </RailCard>

          <RailCard title="源语监控">
            <Waveform
              peaks={material.peaks}
              duration={material.duration}
              height={48}
              color="#38bdf8"
              cursor={t.player.time + material.trim.start}
              highlight={{ start: material.trim.start, end: material.trim.end }}
              markers={markers.map((m) => ({
                t: m.t + material.trim.start,
                color: m.type === 'evs-short' ? '#0ea5e9' : '#6366f1',
              }))}
            />
            {t.state === 'training' ? (
              <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2">
                <LevelMeter wave={t.level.wave} level={t.level.rms} />
              </div>
            ) : null}
          </RailCard>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        {hasSlides ? (
          <SlideDeck
            className="min-h-0 flex-1"
            slides={material.slides!}
            index={slideIndex}
            onChange={setSlideIndex}
            fontSize={fontSize}
            lineHeight={1.7}
            allowFullscreen
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 rounded-xl border border-white/10 bg-white/[0.02]">
            <div className="text-center">
              <div className="font-mono text-6xl font-semibold tabular-nums tracking-tight">
                {fmtClock(t.player.time)}
                <span className="ml-2 text-lg text-slate-500">/ {fmtSec(effDur)}</span>
              </div>
              <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-slate-500">
                <Timer className="h-3.5 w-3.5" />
                译语已录 {t.elapsed.toFixed(1)}s
                {t.state === 'paused' ? ' · 已暂停（两轨同步）' : ''}
              </div>
            </div>
            <div className="w-full max-w-xl px-6">
              <EvsBar dark sourceT={t.player.time} duration={effDur} target={evsTarget} />
            </div>
            {t.state === 'training' ? (
              <div className="w-full max-w-md px-6">
                <LevelMeter wave={t.level.wave} level={t.level.rms} />
              </div>
            ) : null}
            {!hasSlides ? (
              <p className="max-w-sm px-6 text-center text-[11px] text-slate-600">
                无稿同传刻意不提供文字材料。若需要看屏，可在右侧上传 PPT/PDF 作为背景参考。
              </p>
            ) : null}
          </div>
        )}

        {material.kind === 'video' ? (
          <VideoStage el={t.player.el} className="max-h-[30vh] shrink-0 rounded-lg" />
        ) : null}

        {markers.length ? (
          <div className="flex shrink-0 items-center justify-end gap-1.5">
            <Badge variant="secondary" className="bg-white/10 text-[10px] text-slate-300">
              本轮 {markers.length} 个 EVS 标记
            </Badge>
          </div>
        ) : null}
      </div>
    </TrainShell>
  );
}
