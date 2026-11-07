import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Mic, Pause, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader, Section } from '@/components/PageHeader';
import { EvsBar } from '@/components/ScriptView';
import { LevelMeter } from '@/components/NotePad';
import { Waveform } from '@/components/Waveform';
import { RateSelect } from '@/components/RateSelect';
import { VideoStage } from '@/components/VideoStage';

import { useApp } from '@/store/useApp';
import { useAudioUrl, useHotkeys } from '@/lib/hooks';
import { buildSession, useSimTraining } from '@/lib/useSimTraining';
import { fmtSec } from '@/lib/metrics';
import type { Material, Session } from '@/types';

export default function Shadowing() {
  const { materialId } = useParams();
  const nav = useNavigate();
  const { materials, saveSession } = useApp();
  const material = materials.find((m) => m.id === materialId);
  if (!material) return <div className="p-6 text-sm text-muted-foreground">素材不存在</div>;
  return <Runner material={material} saveSession={saveSession} nav={nav} />;
}

function Runner({ material, saveSession, nav }: { material: Material; saveSession: (s: Session) => Promise<void>; nav: (p: string) => void }) {
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
    <>
      <PageHeader
        title={`影子练习 · ${material.title}`}
        desc={`${lang === 'source' ? '源语跟述' : '译语跟述'} · ${type === 'phoneme' ? '音位跟述（几乎同步）' : '片语跟述（滞后数秒）'}。空格开始/暂停，E 打点，1 偏短 / 2 偏长。`}
        actions={
          <>
            <Badge variant="secondary">{fmtSec(effDur)}</Badge>
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

      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Section title="跟述中">
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="text-5xl font-semibold tabular-nums tracking-tight">
              {fmtSec(t.player.time)}
              <span className="text-lg text-muted-foreground"> / {fmtSec(effDur)}</span>
            </div>
            <div className="w-full">
              <EvsBar sourceT={t.player.time} duration={effDur} target={evsTarget} />
            </div>
            {t.state === 'training' ? <LevelMeter wave={t.level.wave} level={t.level.rms} /> : null}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => beat(0)} disabled={t.state !== 'training'}>
                E 打点（跟上目标）
              </Button>
              <Button size="sm" variant="outline" onClick={() => beat(-1)} disabled={t.state !== 'training'}>
                1 偏短
              </Button>
              <Button size="sm" variant="outline" onClick={() => beat(1)} disabled={t.state !== 'training'}>
                2 偏长
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              已打点 {samples.length} 次 · 复盘时可查看 EVS 偏差曲线
            </div>
          </div>
        </Section>

        <Section title="训练参数">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <Label className="text-xs">跟述语言</Label>
              <Select value={lang} onValueChange={(v) => setLang(v as any)}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="source">源语跟述</SelectItem>
                  <SelectItem value="target">译语跟述</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">跟述类型</Label>
              <Select value={type} onValueChange={(v) => setType(v as any)}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="phoneme">音位跟述</SelectItem>
                  <SelectItem value="phrase">片语跟述</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">目标 EVS（秒）</Label>
              <Input
                className="h-8"
                type="number"
                step={0.5}
                value={evsTarget}
                onChange={(e) => setEvsTarget(Math.max(0, Number(e.target.value)))}
              />
            </div>
            <div>
              <Label className="text-xs">源语变速</Label>
              <RateSelect value={t.player.rate} onChange={t.player.setRate} compact />
            </div>
          </div>
        </Section>

        {material.kind === 'video' ? (
          <VideoStage el={t.player.el} className="aspect-video max-h-[44vh] w-full" />
        ) : null}
        <Section title="源语波形">
          <Waveform
            peaks={material.peaks}
            duration={material.duration}
            height={56}
            cursor={t.player.time + material.trim.start}
            highlight={{ start: material.trim.start, end: material.trim.end }}
            markers={samples.map((s) => ({ t: s.t + material.trim.start, color: '#0ea5e9' }))}
          />
        </Section>
      </div>
    </>
  );
}
