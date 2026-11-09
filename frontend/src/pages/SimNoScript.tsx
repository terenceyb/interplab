import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AudioLines, Layers, Timer } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { EvsBar } from '@/components/ScriptView';
import { SlideDeck } from '@/components/SlideDeck';
import { DocSlots } from '@/components/train/DocSlots';
import { RailCard, RailSwitch, TrainShell } from '@/components/train/TrainShell';
import { MediaPanel } from '@/components/train/MediaPanel';
import { PanelBoard, type PanelSpec, type Rect } from '@/components/train/PanelBoard';
import { useApp } from '@/store/useApp';
import { useAudioUrl, useHotkeys } from '@/lib/hooks';
import { buildSession, useSimTraining } from '@/lib/useSimTraining';
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

  const panels = useMemo<PanelSpec[]>(() => {
    const list: PanelSpec[] = [
      {
        id: 'media',
        title: '音视频 · 源语',
        icon: <AudioLines className="h-3.5 w-3.5" />,
        content: (
          <MediaPanel
            isVideo={material.kind === 'video'}
            el={t.player.el}
            peaks={material.peaks}
            duration={material.duration}
            trim={material.trim}
            time={t.player.time}
            elapsed={t.elapsed}
            level={t.level}
            recording={t.state === 'training'}
            markers={markers.map((m) => ({
              t: m.t + material.trim.start,
              color: m.type === 'evs-short' ? '#0ea5e9' : '#6366f1',
            }))}
            extra={
              <div className="mt-2 w-full max-w-sm px-4">
                <EvsBar sourceT={t.player.time} duration={effDur} target={evsTarget} />
              </div>
            }
          />
        ),
        minW: 280,
        minH: 200,
      },
    ];
    if (hasSlides) {
      list.push({
        id: 'slides',
        title: `看屏材料${material.slidesFile ? ` · ${material.slidesFile}` : ''}`,
        icon: <Layers className="h-3.5 w-3.5" />,
        badge: `${Math.min(slideIndex + 1, material.slides!.length)} / ${material.slides!.length}`,
        content: (
          <SlideDeck
            className="h-full p-2"
            slides={material.slides!}
            index={slideIndex}
            onChange={setSlideIndex}
            fontSize={fontSize}
            lineHeight={1.7}
            sourceKey={material.slidesBlobKey}
            fileName={material.slidesFile}
            allowFullscreen
          />
        ),
        minW: 320,
        minH: 220,
      });
    }
    return list;
  }, [hasSlides, material, slideIndex, fontSize, evsTarget, effDur, markers, t.player, t.elapsed, t.level, t.state]);

  const defaults = useMemo(() => {
    const out: Record<string, Rect> = {};
    if (hasSlides) {
      out.media = { x: 0, y: 0, w: 0.4, h: 1 };
      out.slides = { x: 0.4, y: 0, w: 0.6, h: 1 };
    } else {
      out.media = { x: 0, y: 0, w: 1, h: 1 };
    }
    return out;
  }, [hasSlides]);

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
            className="h-8 rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-40"
          >
            太紧 B
          </button>
          <button
            onClick={() => mark('evs-long')}
            disabled={t.state !== 'training'}
            className="h-8 rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-40"
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
                className="h-8 text-xs"
                type="number"
                step={0.5}
                value={evsTarget}
                onChange={(e) => setEvsTarget(Math.max(0.5, Number(e.target.value)))}
              />
              <span className="text-[11px] text-muted-foreground">秒</span>
            </div>
            <div className="mt-2">
              <EvsBar sourceT={t.player.time} duration={effDur} target={evsTarget} />
            </div>
          </RailCard>

          <RailCard title="看屏材料（可选）" desc="真实会议里译员能看到大屏；PPT 仅作参考，不影响无稿训练">
            <DocSlots
              only="slides"
              slideCount={material.slides?.length}
              slidesFile={material.slidesFile}
              slidesSource={material.slidesSource}
              onSlides={async (doc, fileName) => {
                if (!doc)
                  return saveMaterial({
                    ...material,
                    slides: undefined,
                    slidesFile: undefined,
                    slidesSource: undefined,
                    slidesBlobKey: undefined,
                  });
                await saveMaterial({
                  ...material,
                  slides: doc.slides,
                  slidesFile: fileName,
                  slidesSource: doc.source,
                  slidesBlobKey: doc.sourceKey,
                  docKind: 'slides',
                });
                setSlideIndex(0);
              }}
              onScript={() => undefined}
            />
            {hasSlides ? (
              <div className="mt-2">
                <Label className="text-[11px] text-muted-foreground">文字版字号 {fontSize}px</Label>
                <Slider value={[fontSize]} min={14} max={32} step={1} onValueChange={(v) => setFontSize(v[0])} />
              </div>
            ) : null}
          </RailCard>

          <RailCard title="训练参数">
            <RailSwitch label="干扰音" desc="低音量背景噪声" checked={noise} onChange={setNoise} />
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Timer className="h-3 w-3" /> 本轮标记 {markers.length} 个
            </div>
          </RailCard>
        </>
      }
    >
      <PanelBoard mode="sim-noscript" panels={panels} defaults={defaults} />
    </TrainShell>
  );
}
