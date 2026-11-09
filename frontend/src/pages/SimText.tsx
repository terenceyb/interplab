import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Eye, EyeOff, FileText, Layers, Link2, Link2Off } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ScriptView } from '@/components/ScriptView';
import { SlideDeck } from '@/components/SlideDeck';
import { DocSlots } from '@/components/train/DocSlots';
import { RailCard, RailSwitch, TrainShell } from '@/components/train/TrainShell';
import { LevelMeter } from '@/components/NotePad';
import { Waveform } from '@/components/Waveform';
import { VideoStage } from '@/components/VideoStage';
import { useApp } from '@/store/useApp';
import { useAudioUrl, useHotkeys } from '@/lib/hooks';
import { buildSession, useSimTraining } from '@/lib/useSimTraining';
import { buildScriptPatch } from '@/lib/scriptAttach';
import { findSentenceIndex } from '@/lib/text';
import { fmtSec } from '@/lib/metrics';
import type { Material, Session } from '@/types';

export default function SimText() {
  const { materialId } = useParams();
  const nav = useNavigate();
  const { materials, saveSession, terms, saveMaterial } = useApp();
  const material = materials.find((m) => m.id === materialId);
  if (!material) return <div className="p-6 text-sm text-muted-foreground">素材不存在</div>;
  return (
    <Runner
      material={material}
      saveSession={saveSession}
      saveMaterial={saveMaterial}
      nav={nav}
      terms={terms.map((t) => t.term)}
    />
  );
}

function Runner({
  material,
  saveSession,
  saveMaterial,
  nav,
  terms,
}: {
  material: Material;
  saveSession: (s: Session) => Promise<void>;
  saveMaterial: (m: Material) => Promise<void>;
  nav: (p: string) => void;
  terms: string[];
}) {
  const url = useAudioUrl(material.audioKey);
  const t = useSimTraining(material, url);
  const [fontSize, setFontSize] = useState(19);
  const [lineHeight, setLineHeight] = useState(1.85);
  const [hide, setHide] = useState(false);
  const [hlTerms, setHlTerms] = useState(true);
  const [maskMode, setMaskMode] = useState<'none' | 'tail' | 'random'>('none');
  const [maskRatio, setMaskRatio] = useState(0.2);
  const [saving, setSaving] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [view, setView] = useState<'script' | 'slides'>(
    material.sentences.length ? 'script' : 'slides',
  );

  const hasSlides = !!material.slides?.length;
  const hasScript = material.sentences.length > 0;
  /** 稿件是否带时间码（SRT/VTT 或已校准）——只有这类才能跟随播放 */
  const timed = useMemo(() => material.sentences.some((s) => s.confidence >= 0.9), [material.sentences]);
  const [follow, setFollow] = useState(false);
  const canFollow = timed;

  const curIdx = useMemo(
    () => (follow && canFollow ? findSentenceIndex(material.sentences, t.player.time) : -1),
    [material.sentences, t.player.time, follow, canFollow],
  );

  useHotkeys({
    ' ': () => {
      if (t.state === 'training') t.pause();
      else if (t.state === 'paused') t.resume();
      else t.start();
    },
    h: () => setHide((v) => !v),
    tab: () => hasScript && hasSlides && setView((v) => (v === 'script' ? 'slides' : 'script')),
  });

  const finish = async () => {
    setSaving(true);
    const attempt = await t.stop();
    const session = await buildSession(material, 'sim-text', attempt, {
      rate: t.player.rate,
      hideText: hide,
      follow: follow && canFollow,
      maskMode,
      maskRatio,
    });
    setSaving(false);
    if (session) {
      await saveSession(session);
      nav(`/review/${session.id}`);
    }
  };

  const patch = (p: Partial<Material>) => saveMaterial({ ...material, ...p });

  // 没有文字稿时自动只呈现幻灯片，避免出现空白主区
  const showSlides = hasSlides && (view === 'slides' || !hasScript);
  const empty = !hasScript && !hasSlides;

  return (
    <TrainShell
      mode="sim-text"
      materialTitle={material.title}
      stage={t.state === 'done' ? 'paused' : t.state}
      time={t.player.time}
      duration={Math.max(0, material.trim.end - material.trim.start)}
      recorded={t.elapsed}
      rate={t.player.rate}
      onRate={t.player.setRate}
      onStart={t.start}
      onPause={t.pause}
      onResume={t.resume}
      onFinish={finish}
      onExit={() => nav(`/material/${material.id}`)}
      busy={saving}
      hint={
        hasSlides
          ? '← / → 翻页 · 空格 开始/暂停 · H 隐藏稿件'
          : '空格 开始/暂停 · H 隐藏稿件 · 点击任意句可跳转'
      }
      extras={
        <>
          {hasScript && hasSlides ? (
            <button
              onClick={() => setView((v) => (v === 'script' ? 'slides' : 'script'))}
              className="flex h-8 items-center gap-1.5 rounded-md bg-white/10 px-2.5 text-[11px] text-slate-200 hover:bg-white/15"
              title="切换视图（Tab）"
            >
              {view === 'script' ? <Layers className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
              {view === 'script' ? '幻灯片' : '稿件'}
            </button>
          ) : null}
          {canFollow ? (
            <button
              onClick={() => setFollow((v) => !v)}
              className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] transition-colors ${
                follow ? 'bg-amber-400/20 text-amber-200' : 'bg-white/10 text-slate-300 hover:bg-white/15'
              }`}
              title="按字幕时间码高亮当前句"
            >
              {follow ? <Link2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
              {follow ? '跟随中' : '跟随'}
            </button>
          ) : null}
          <button
            onClick={() => setHide((v) => !v)}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
              hide ? 'bg-amber-400/20 text-amber-200' : 'text-slate-400 hover:bg-white/10 hover:text-white'
            }`}
            title="隐藏稿件（H）"
          >
            {hide ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </>
      }
      railTitle="带稿同传面板"
      rail={
        <>
          <RailCard title="材料" desc="PPT 与文字稿分开上传，互不覆盖">
            <DocSlots
              dark
              slideCount={material.slides?.length}
              slidesFile={material.slidesFile}
              slidesSource={material.slidesSource}
              scriptFile={material.scriptFile}
              sentenceCount={material.sentences.length}
              blockCount={material.blocks?.length ?? 0}
              onSlides={async (doc, fileName) => {
                if (!doc) {
                  await patch({ slides: undefined, slidesFile: undefined, slidesSource: undefined });
                  setView('script');
                  return;
                }
                await patch({
                  slides: doc.slides,
                  slidesFile: fileName,
                  slidesSource: doc.source,
                  docKind: 'slides',
                });
                setSlideIndex(0);
                setView('slides');
              }}
              onScript={async (doc, fileName) => {
                if (!doc) {
                  await patch({ script: undefined, blocks: undefined, sentences: [], scriptFile: undefined });
                  return;
                }
                const p = await buildScriptPatch(material, doc, fileName);
                await patch(p);
                setView('script');
              }}
            />
          </RailCard>

          <RailCard title="阅读设置">
            <div className="space-y-2.5">
              <div>
                <Label className="text-[11px] text-slate-400">字号 {fontSize}px</Label>
                <Slider value={[fontSize]} min={14} max={30} step={1} onValueChange={(v) => setFontSize(v[0])} />
              </div>
              <div>
                <Label className="text-[11px] text-slate-400">行距 {lineHeight.toFixed(1)}</Label>
                <Slider
                  value={[lineHeight]}
                  min={1.4}
                  max={2.6}
                  step={0.1}
                  onValueChange={(v) => setLineHeight(v[0])}
                />
              </div>
              <RailSwitch label="术语高亮" checked={hlTerms} onChange={setHlTerms} />
            </div>
          </RailCard>

          <RailCard title="遮挡训练" desc="保留稿件支撑，同时强制听辨投入">
            <div className="space-y-2">
              <Select value={maskMode} onValueChange={(v) => setMaskMode(v as any)}>
                <SelectTrigger className="h-8 border-white/15 bg-white/5 text-xs text-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不遮挡</SelectItem>
                  <SelectItem value="tail">遮挡句末若干词</SelectItem>
                  <SelectItem value="random">随机遮挡短语</SelectItem>
                </SelectContent>
              </Select>
              {maskMode !== 'none' ? (
                <div>
                  <Label className="text-[11px] text-slate-400">遮挡比例 {Math.round(maskRatio * 100)}%</Label>
                  <Slider
                    value={[maskRatio]}
                    min={0.1}
                    max={0.5}
                    step={0.05}
                    onValueChange={(v) => setMaskRatio(v[0])}
                  />
                </div>
              ) : null}
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
              markers={material.sentences
                .filter((s) => s.confidence > 0.6)
                .map((s) => ({ t: s.start + material.trim.start, color: 'rgba(148,163,184,0.5)' }))}
            />
            <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
              <span>高置信句 {material.sentences.filter((s) => s.confidence >= 0.7).length}</span>
              <span className="text-amber-400">
                待校准 {material.sentences.filter((s) => s.confidence < 0.6).length}
              </span>
            </div>
            {t.state === 'training' ? (
              <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2">
                <div className="mb-1 text-[11px] text-emerald-300">正在录制译语</div>
                <LevelMeter wave={t.level.wave} level={t.level.rms} />
              </div>
            ) : null}
            <div className="mt-2 text-[11px] text-slate-500">
              译语已录 <span className="font-mono text-slate-300">{t.elapsed.toFixed(1)}s</span> · 源语{' '}
              {fmtSec(t.player.time)}
            </div>
          </RailCard>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center">
            <p className="text-sm text-slate-300">这份素材还没有任何材料</p>
            <p className="max-w-md text-xs text-slate-500">
              上传 PPT/PDF 可以按页看屏翻译；上传 Word/字幕稿可以对照原文。两者可以同时存在。
            </p>
            <div className="w-full max-w-xl">
              <DocSlots
                dark
                onSlides={async (doc, fileName) => {
                  if (!doc) return;
                  await patch({ slides: doc.slides, slidesSource: doc.source, slidesFile: fileName, docKind: 'slides' });
                  setView('slides');
                }}
                onScript={async (doc, fileName) => {
                  if (!doc) return;
                  await patch(await buildScriptPatch(material, doc, fileName));
                  setView('script');
                }}
              />
            </div>
          </div>
        ) : showSlides ? (
          <SlideDeck
            slides={material.slides!}
            index={slideIndex}
            onChange={setSlideIndex}
            fontSize={fontSize}
            lineHeight={lineHeight}
            hide={hide}
            maskMode={maskMode}
            maskRatio={maskRatio}
            terms={terms}
            highlightTerms={hlTerms}
            allowFullscreen
            className="min-h-0 flex-1"
          />
        ) : hasScript ? (
          <ScriptView
            dark
            className="min-h-0 flex-1"
            sentences={material.sentences}
            blocks={material.blocks}
            currentIdx={curIdx}
            follow={follow && canFollow}
            terms={terms}
            highlightTerms={hlTerms}
            maskMode={maskMode}
            maskRatio={maskRatio}
            fontSize={fontSize}
            lineHeight={lineHeight}
            hide={hide}
            onSentenceClick={(i) => t.player.seek(material.sentences[i].start)}
          />
        ) : null}

        {material.kind === 'video' ? (
          <VideoStage el={t.player.el} className="max-h-[32vh] shrink-0 rounded-lg" />
        ) : null}

        {follow && canFollow ? (
          <div className="shrink-0 text-right text-[11px] text-slate-500">
            <Badge variant="secondary" className="bg-white/10 text-[10px] text-slate-300">
              已读 {Math.max(0, curIdx)} / {material.sentences.length} 句
            </Badge>
          </div>
        ) : null}
      </div>
    </TrainShell>
  );
}
