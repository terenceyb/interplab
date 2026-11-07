import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Mic, Pause, Play, Square, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { PageHeader, Section } from '@/components/PageHeader';
import { EvsBar } from '@/components/ScriptView';
import { LevelMeter } from '@/components/NotePad';
import { Waveform } from '@/components/Waveform';
import { useApp } from '@/store/useApp';
import { useAudioUrl, useHotkeys } from '@/lib/hooks';
import { buildSession, useSimTraining } from '@/lib/useSimTraining';
import { fmtSec } from '@/lib/metrics';
import * as db from '@/lib/db';
import type { Material, Marker, Session } from '@/types';

export default function SimNoScript() {
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
  const [evsTarget, setEvsTarget] = useState(2.5);
  const [noise, setNoise] = useState(false);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [saving, setSaving] = useState(false);
  const effDur = Math.max(0, material.trim.end - material.trim.start);

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
    <>
      <PageHeader
        title={`无稿同传 · ${material.title}`}
        desc="极简界面，减少认知负荷。空格开始/暂停，B 标记「跟得太紧」，N 标记「跟得太松」。"
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
        <Section title="训练中">
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="text-5xl font-semibold tabular-nums tracking-tight">
              {fmtSec(t.player.time)}
              <span className="text-lg text-muted-foreground"> / {fmtSec(effDur)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Timer className="h-3.5 w-3.5" />
              译语已录 {t.elapsed.toFixed(1)}s
              {t.state === 'paused' ? ' · 已暂停（两轨同步）' : ''}
            </div>
            <div className="w-full">
              <EvsBar sourceT={t.player.time} duration={effDur} target={evsTarget} />
            </div>
            {t.state === 'training' ? <LevelMeter wave={t.level.wave} level={t.level.rms} /> : null}
            <Waveform
              peaks={material.peaks}
              duration={material.duration}
              height={56}
              cursor={t.player.time + material.trim.start}
              highlight={{ start: material.trim.start, end: material.trim.end }}
              markers={markers.map((m) => ({
                t: m.t + material.trim.start,
                color: m.type === 'evs-short' ? '#0ea5e9' : '#6366f1',
              }))}
            />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => mark('evs-short')} disabled={t.state !== 'training'}>
                跟得太紧（B）
              </Button>
              <Button size="sm" variant="outline" onClick={() => mark('evs-long')} disabled={t.state !== 'training'}>
                跟得太松（N）
              </Button>
            </div>
            {markers.length ? (
              <div className="text-xs text-muted-foreground">本轮已记录 {markers.length} 个 EVS 自报告标记</div>
            ) : null}
          </div>
        </Section>

        <Section title="训练参数">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">目标 EVS（秒）</Label>
              <Input
                className="h-8"
                type="number"
                step={0.5}
                value={evsTarget}
                onChange={(e) => setEvsTarget(Math.max(0.5, Number(e.target.value)))}
              />
            </div>
            <div>
              <Label className="text-xs">源语变速</Label>
              <Select value={String(t.player.rate)} onValueChange={(v) => t.player.setRate(Number(v))}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0.75, 0.9, 1, 1.1, 1.25].map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {r}×
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border px-2">
              <div>
                <Label className="text-xs">干扰音</Label>
                <p className="text-[11px] text-muted-foreground">低音量背景噪声</p>
              </div>
              <Switch checked={noise} onCheckedChange={setNoise} />
            </div>
          </div>
        </Section>
      </div>
    </>
  );
}
