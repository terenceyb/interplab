import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Eye, EyeOff, Mic, Pause, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PageHeader, Section, Empty } from '@/components/PageHeader';
import { ScriptView } from '@/components/ScriptView';
import { LevelMeter } from '@/components/NotePad';
import { Waveform } from '@/components/Waveform';
import { useApp } from '@/store/useApp';
import { useAudioUrl, useHotkeys } from '@/lib/hooks';
import { buildSession, useSimTraining } from '@/lib/useSimTraining';
import { findSentenceIndex } from '@/lib/text';
import { fmtSec } from '@/lib/metrics';
import type { Material, Session } from '@/types';

export default function SimText() {
  const { materialId } = useParams();
  const nav = useNavigate();
  const { materials, saveSession, terms } = useApp();
  const material = materials.find((m) => m.id === materialId);
  if (!material) return <div className="p-6 text-sm text-muted-foreground">素材不存在</div>;
  return <Runner material={material} saveSession={saveSession} nav={nav} terms={terms.map((t) => t.term)} />;
}

function Runner({
  material,
  saveSession,
  nav,
  terms,
}: {
  material: Material;
  saveSession: (s: Session) => Promise<void>;
  nav: (p: string) => void;
  terms: string[];
}) {
  const url = useAudioUrl(material.audioKey);
  const t = useSimTraining(material, url);
  const [fontSize, setFontSize] = useState(18);
  const [lineHeight, setLineHeight] = useState(1.9);
  const [hide, setHide] = useState(false);
  const [hlTerms, setHlTerms] = useState(true);
  const [maskMode, setMaskMode] = useState<'none' | 'tail' | 'random'>('none');
  const [maskRatio, setMaskRatio] = useState(0.2);
  const [saving, setSaving] = useState(false);

  const curIdx = useMemo(() => findSentenceIndex(material.sentences, t.player.time), [material.sentences, t.player.time]);

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
      maskMode,
      maskRatio,
    });
    setSaving(false);
    if (session) {
      await saveSession(session);
      nav(`/review/${session.id}`);
    }
  };

  if (!material.sentences.length) {
    return (
      <>
        <PageHeader title={`带稿同传 · ${material.title}`} />
        <div className="p-6">
          <Empty
            text="该素材还没有对齐的稿件，请先到素材页导入文本或字幕并完成对齐"
            action={<Button onClick={() => nav(`/material/${material.id}`)}>去导入稿件</Button>}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`带稿同传 · ${material.title}`}
        desc="文本随音频进度滚动高亮（跟随对齐时间戳，而非匀速滚动）。空格开始/暂停，H 隐藏文本。"
        actions={
          <>
            <Badge variant="secondary">已读 {Math.max(0, curIdx)}/{material.sentences.length} 句</Badge>
            {t.state === 'idle' ? (
              <Button size="sm" onClick={t.start}>
                <Mic className="mr-1 h-3.5 w-3.5" /> 开始训练
              </Button>
            ) : t.state === 'training' ? (
              <>
                <Button size="sm" variant="outline" onClick={t.pause}>
                  <Pause className="mr-1 h-3.5 w-3.5" /> 暂停
                </Button>
                <Button size="sm" variant="destructive" onClick={finish} disabled={saving}>
                  <Square className="mr-1 h-3.5 w-3.5" /> 结束并复盘
                </Button>
              </>
            ) : t.state === 'paused' ? (
              <>
                <Button size="sm" onClick={t.resume}>
                  <Play className="mr-1 h-3.5 w-3.5" /> 继续
                </Button>
                <Button size="sm" variant="destructive" onClick={finish} disabled={saving}>
                  <Square className="mr-1 h-3.5 w-3.5" /> 结束并复盘
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 p-6 lg:grid-cols-4">
        <div className="space-y-4 lg:col-span-3">
          <Section
            title="讲话稿"
            desc="当前朗读句高亮，已读淡化；术语与专有名词以amber底色标记。"
            actions={
              <div className="flex items-center gap-2">
                <Label className="text-xs">隐藏文本</Label>
                <Switch checked={hide} onCheckedChange={setHide} />
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setHide((v) => !v)}>
                  {hide ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
            }
          >
            <ScriptView
              sentences={material.sentences}
              currentIdx={curIdx}
              terms={terms}
              highlightTerms={hlTerms}
              maskMode={maskMode}
              maskRatio={maskRatio}
              fontSize={fontSize}
              lineHeight={lineHeight}
              hide={hide}
              onSentenceClick={(i) => t.player.seek(material.sentences[i].start)}
            />
          </Section>

          <Section title="源语进度">
            <Waveform
              peaks={material.peaks}
              duration={material.duration}
              height={64}
              cursor={t.player.time + material.trim.start}
              highlight={{ start: material.trim.start, end: material.trim.end }}
              markers={material.sentences
                .filter((s) => s.confidence > 0.6)
                .map((s) => ({ t: s.start + material.trim.start, color: 'rgba(148,163,184,0.5)' }))}
            />
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                源语 {fmtSec(t.player.time)} / {fmtSec(Math.max(0, material.trim.end - material.trim.start))}
              </span>
              <span>译语已录 {t.elapsed.toFixed(1)}s</span>
            </div>
            {t.state === 'training' ? (
              <div className="mt-2 rounded-md border border-emerald-500/40 bg-emerald-50 p-2">
                <div className="mb-1 text-xs font-medium text-emerald-700">正在录制译语（与源语同步）</div>
                <LevelMeter wave={t.level.wave} level={t.level.rms} />
              </div>
            ) : null}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="界面配置">
            <div className="space-y-3">
              <div>
                <Label className="text-xs">字号 {fontSize}px</Label>
                <Slider value={[fontSize]} min={14} max={28} step={1} onValueChange={(v) => setFontSize(v[0])} />
              </div>
              <div>
                <Label className="text-xs">行距 {lineHeight.toFixed(1)}</Label>
                <Slider value={[lineHeight]} min={1.4} max={2.6} step={0.1} onValueChange={(v) => setLineHeight(v[0])} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">术语高亮</Label>
                <Switch checked={hlTerms} onCheckedChange={setHlTerms} />
              </div>
              <div>
                <Label className="text-xs">变速</Label>
                <Select value={String(t.player.rate)} onValueChange={(v) => t.player.setRate(Number(v))}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[0.75, 1, 1.1, 1.25].map((r) => (
                      <SelectItem key={r} value={String(r)}>
                        {r}×
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Section>

          <Section title="文本遮挡训练" desc="在稿件支撑下保持听辨投入，逐步过渡到无稿同传。">
            <div className="space-y-3">
              <Select value={maskMode} onValueChange={(v) => setMaskMode(v as any)}>
                <SelectTrigger className="h-8">
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
                  <Label className="text-xs">遮挡比例 {Math.round(maskRatio * 100)}%</Label>
                  <Slider value={[maskRatio]} min={0.1} max={0.5} step={0.05} onValueChange={(v) => setMaskRatio(v[0])} />
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                遮挡只在训练视图生效，不影响稿件数据与复盘文本。
              </p>
            </div>
          </Section>

          <Section title="对齐质量">
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">高置信句</span>
                <span>{material.sentences.filter((s) => s.confidence >= 0.7).length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">待校准句</span>
                <span className="text-amber-600">{material.sentences.filter((s) => s.confidence < 0.6).length}</span>
              </div>
              <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => nav(`/material/${material.id}`)}>
                去校准对齐
              </Button>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
