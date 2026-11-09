import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AudioLines, Eye, EyeOff, FileText, Layers, Link2, Link2Off } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ScriptView } from '@/components/ScriptView';
import { SlideDeck } from '@/components/SlideDeck';
import { DocSlots } from '@/components/train/DocSlots';
import { RailCard, RailSwitch, TrainShell } from '@/components/train/TrainShell';
import { MediaPanel } from '@/components/train/MediaPanel';
import { PanelBoard, type PanelSpec, type Rect } from '@/components/train/PanelBoard';
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

  /* ---------------- 模块与默认排版 ---------------- */

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
            markers={material.sentences
              .filter((s) => s.confidence > 0.6)
              .map((s) => ({ t: s.start + material.trim.start, color: 'rgba(100,116,139,0.45)' }))}
          />
        ),
        minW: 260,
        minH: 170,
      },
    ];
    if (hasSlides) {
      list.push({
        id: 'slides',
        title: `幻灯片${material.slidesFile ? ` · ${material.slidesFile}` : ''}`,
        icon: <Layers className="h-3.5 w-3.5" />,
        badge: `${Math.min(slideIndex + 1, material.slides!.length)} / ${material.slides!.length}`,
        content: (
          <SlideDeck
            className="h-full p-2"
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
            sourceKey={material.slidesBlobKey}
            fileName={material.slidesFile}
            allowFullscreen
          />
        ),
        minW: 320,
        minH: 220,
      });
    }
    if (hasScript) {
      list.push({
        id: 'script',
        title: '讲话稿',
        icon: <FileText className="h-3.5 w-3.5" />,
        badge: `${material.sentences.length} 句`,
        content: (
          <ScriptView
            className="h-full rounded-none border-0"
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
        ),
        minW: 320,
        minH: 160,
      });
    }
    return list;
  }, [
    hasSlides,
    hasScript,
    material,
    slideIndex,
    fontSize,
    lineHeight,
    hide,
    maskMode,
    maskRatio,
    terms,
    hlTerms,
    curIdx,
    follow,
    canFollow,
    t.player,
    t.elapsed,
    t.level,
    t.state,
  ]);

  /**
   * 默认排版：音视频与 PPT **并排居上**、文稿在下。
   * 少了哪块就自动补位，不留空洞。
   */
  const defaults = useMemo(() => {
    const out: Record<string, Rect> = {};
    const ids = panels.map((p) => p.id);
    if (ids.length === 3) {
      out.media = { x: 0, y: 0, w: 0.42, h: 0.46 };
      out.slides = { x: 0.42, y: 0, w: 0.58, h: 0.46 };
      out.script = { x: 0, y: 0.46, w: 1, h: 0.54 };
    } else if (ids.length === 2 && ids.includes('script')) {
      out.media = { x: 0, y: 0, w: 1, h: 0.42 };
      out.script = { x: 0, y: 0.42, w: 1, h: 0.58 };
    } else if (ids.length === 2) {
      out.media = { x: 0, y: 0, w: 0.42, h: 1 };
      out.slides = { x: 0.42, y: 0, w: 0.58, h: 1 };
    } else {
      for (const id of ids) out[id] = { x: 0, y: 0, w: 1, h: 1 };
    }
    return out;
  }, [panels]);

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
          ? '← / → 翻页 · 空格 开始/暂停 · H 隐藏材料 · 拖动模块标题栏可换位置'
          : '空格 开始/暂停 · H 隐藏稿件 · 点击任意句可跳转'
      }
      extras={
        <>
          {canFollow ? (
            <button
              onClick={() => setFollow((v) => !v)}
              className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] transition-colors ${
                follow
                  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-200'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
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
              hide
                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-200'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
            title="隐藏材料（H）"
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
              slideCount={material.slides?.length}
              slidesFile={material.slidesFile}
              slidesSource={material.slidesSource}
              scriptFile={material.scriptFile}
              sentenceCount={material.sentences.length}
              blockCount={material.blocks?.length ?? 0}
              onSlides={async (doc, fileName) => {
                if (!doc) {
                  await patch({
                    slides: undefined,
                    slidesFile: undefined,
                    slidesSource: undefined,
                    slidesBlobKey: undefined,
                  });
                  return;
                }
                await patch({
                  slides: doc.slides,
                  slidesFile: fileName,
                  slidesSource: doc.source,
                  slidesBlobKey: doc.sourceKey,
                  docKind: 'slides',
                });
                setSlideIndex(0);
              }}
              onScript={async (doc, fileName) => {
                if (!doc) {
                  await patch({ script: undefined, blocks: undefined, sentences: [], scriptFile: undefined });
                  return;
                }
                await patch(await buildScriptPatch(material, doc, fileName));
              }}
            />
          </RailCard>

          <RailCard title="阅读设置">
            <div className="space-y-2.5">
              <div>
                <Label className="text-[11px] text-muted-foreground">字号 {fontSize}px</Label>
                <Slider value={[fontSize]} min={14} max={30} step={1} onValueChange={(v) => setFontSize(v[0])} />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">行距 {lineHeight.toFixed(1)}</Label>
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
              <Select value={maskMode} onValueChange={(v) => setMaskMode(v as 'none' | 'tail' | 'random')}>
                <SelectTrigger className="h-8 text-xs">
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
                  <Label className="text-[11px] text-muted-foreground">遮挡比例 {Math.round(maskRatio * 100)}%</Label>
                  <Slider
                    value={[maskRatio]}
                    min={0.1}
                    max={0.5}
                    step={0.05}
                    onValueChange={(v) => setMaskRatio(v[0])}
                  />
                </div>
              ) : null}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                遮挡只在「文字版」生效；看原版式时请切回文字版再练。
              </p>
            </div>
          </RailCard>

          <RailCard title="稿件置信度">
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">
                高置信句 {material.sentences.filter((s) => s.confidence >= 0.7).length}
              </span>
              <span className="text-amber-600 dark:text-amber-400">
                待校准 {material.sentences.filter((s) => s.confidence < 0.6).length}
              </span>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              译语已录 <span className="font-mono">{t.elapsed.toFixed(1)}s</span> · 源语 {fmtSec(t.player.time)}
            </div>
          </RailCard>
        </>
      }
    >
      {empty ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center">
          <p className="text-sm">这份素材还没有任何材料</p>
          <p className="max-w-md text-xs text-muted-foreground">
            上传 PPT/PDF 可以按原版式看屏翻译；上传 Word/字幕稿可以对照原文。两者可以同时存在，会同屏排布。
          </p>
          <div className="w-full max-w-xl">
            <DocSlots
              onSlides={async (doc, fileName) => {
                if (!doc) return;
                await patch({
                  slides: doc.slides,
                  slidesSource: doc.source,
                  slidesFile: fileName,
                  slidesBlobKey: doc.sourceKey,
                  docKind: 'slides',
                });
              }}
              onScript={async (doc, fileName) => {
                if (!doc) return;
                await patch(await buildScriptPatch(material, doc, fileName));
              }}
            />
          </div>
        </div>
      ) : (
        <PanelBoard mode="sim-text" panels={panels} defaults={defaults} />
      )}
    </TrainShell>
  );
}
