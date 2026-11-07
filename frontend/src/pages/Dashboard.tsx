import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Flame, Mic, Sparkles, Target, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader, Section, Empty, Stat } from '@/components/PageHeader';
import { useApp } from '@/store/useApp';
import { computeBadges, computeStreak, goalProgress } from '@/lib/stats';
import { fmtSec } from '@/lib/metrics';
import { MODE_LABEL } from '@/types';

export default function Dashboard() {
  const { sessions, materials, plan, profile } = useApp();
  const nav = useNavigate();
  const [quickMat, setQuickMat] = useState('');
  const [quickMode, setQuickMode] = useState<string>('consecutive');

  const streak = useMemo(() => computeStreak(sessions), [sessions]);
  const badges = useMemo(() => computeBadges(sessions), [sessions]);
  const totalSec = sessions.reduce((s, x) => s + x.duration, 0);
  const weekCount = sessions.filter((s) => s.createdAt >= Date.now() - 7 * 864e5).length;
  const dueReplay = materials.filter((m) => m.replayAt && m.replayAt <= Date.now());
  const recent = sessions.slice(0, 5);
  const gotBadges = badges.filter((b) => b.got);

  return (
    <>
      <PageHeader
        title={`${profile.name}的训练工作台`}
        desc="个人自学闭环：上传素材 → 训练 → 双轨复盘 → 成长追踪。所有数据仅保存在本机浏览器。"
        actions={
          <Button size="sm" onClick={() => nav('/library')}>
            <Upload className="mr-1 h-3.5 w-3.5" /> 上传素材
          </Button>
        }
      />

      <div className="grid gap-3 p-6 md:grid-cols-4">
        <Stat label="连续训练" value={`${streak} 天`} hint="保持节奏比单次时长更重要" />
        <Stat label="累计训练时长" value={fmtSec(totalSec)} hint={`共 ${sessions.length} 轮`} />
        <Stat label="近 7 天训练" value={`${weekCount} 次`} />
        <Stat label="获得徽章" value={`${gotBadges.length}/${badges.length}`} hint="仅本人可见" />
      </div>

      <div className="grid gap-4 px-6 pb-6 lg:grid-cols-3">
        <Section title="快速开始" desc="选好素材与训练类型，直接进入训练。" className="lg:col-span-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <label className="text-xs text-muted-foreground">素材</label>
              <Select value={quickMat} onValueChange={setQuickMat}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="选择素材" />
                </SelectTrigger>
                <SelectContent>
                  {materials.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-40">
              <label className="text-xs text-muted-foreground">训练类型</label>
              <Select value={quickMode} onValueChange={setQuickMode}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MODE_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={!quickMat}
              onClick={() =>
                nav(
                  `/train/${quickMode === 'consecutive' ? 'consecutive' : quickMode}/${quickMat}`,
                )
              }
            >
              开始训练 <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {materials.slice(0, 6).map((m) => (
              <button
                key={m.id}
                onClick={() => nav(`/material/${m.id}`)}
                className="rounded-md border px-3 py-2 text-left text-xs hover:bg-accent"
              >
                <div className="truncate font-medium">{m.title}</div>
                <div className="mt-0.5 text-muted-foreground">
                  {fmtSec(Math.max(0, m.trim.end - m.trim.start))} · 已练{' '}
                  {sessions.filter((s) => s.materialId === m.id).length} 轮
                </div>
              </button>
            ))}
            {!materials.length ? (
              <Empty text="还没有素材" action={<Button size="sm" onClick={() => nav('/library')}>去上传</Button>} />
            ) : null}
          </div>
        </Section>

        <Section title="训练计划进度">
          {plan.length ? (
            <div className="space-y-3">
              {plan.map((g) => {
                const { done, target } = goalProgress(g, sessions);
                return (
                  <div key={g.id}>
                    <div className="flex items-center justify-between text-xs">
                      <span>
                        {g.mode === 'review' ? '完成复盘' : MODE_LABEL[g.mode]} · 每{g.period === 'week' ? '周' : '月'}
                      </span>
                      <span className="tabular-nums">
                        {done}/{target}
                      </span>
                    </div>
                    <Progress className="mt-1 h-2" value={Math.min(100, (done / Math.max(1, target)) * 100)} />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">还没有设定目标。设定个人目标可以替代外部监督，帮助维持节奏。</p>
              <Button size="sm" variant="outline" onClick={() => nav('/growth')}>
                <Target className="mr-1 h-3.5 w-3.5" /> 去设定目标
              </Button>
            </div>
          )}
          {dueReplay.length ? (
            <div className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              <div className="font-medium">计划重练到期</div>
              <div className="mt-1 space-y-1">
                {dueReplay.map((m) => (
                  <button key={m.id} className="block hover:underline" onClick={() => nav(`/material/${m.id}`)}>
                    {m.title}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </Section>

        <Section title="最近训练" desc="继续复盘或重练" className="lg:col-span-2">
          <div className="space-y-1">
            {recent.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
                <span className="w-32 shrink-0 truncate font-medium">{s.materialTitle}</span>
                <Badge variant="secondary" className="text-[10px]">
                  {MODE_LABEL[s.mode]}
                </Badge>
                <span className="text-muted-foreground">第 {s.attemptNumber} 轮</span>
                <span className="text-muted-foreground">标记 {s.markers.length}</span>
                <span className="ml-auto text-muted-foreground">{new Date(s.createdAt).toLocaleDateString('zh-CN')}</span>
                <Button size="sm" variant="outline" className="h-7" onClick={() => nav(`/review/${s.id}`)}>
                  复盘
                </Button>
              </div>
            ))}
            {!recent.length ? (
              <Empty
                icon={<Mic className="h-5 w-5 text-muted-foreground" />}
                text="还没有训练记录，先跑一轮交传试试"
              />
            ) : null}
          </div>
        </Section>

        <Section title="成就徽章" desc="仅本人可见，不做社交排行。">
          <div className="grid grid-cols-2 gap-2">
            {badges.map((b) => (
              <div
                key={b.key}
                className={`rounded-md border px-2 py-2 text-center ${b.got ? 'border-amber-300 bg-amber-50' : 'opacity-60'}`}
              >
                <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-muted">
                  {b.key.startsWith('streak') ? (
                    <Flame className={`h-3.5 w-3.5 ${b.got ? 'text-amber-500' : ''}`} />
                  ) : (
                    <Sparkles className={`h-3.5 w-3.5 ${b.got ? 'text-amber-500' : ''}`} />
                  )}
                </div>
                <div className="mt-1 text-[11px] font-medium">{b.label}</div>
                <div className="text-[10px] text-muted-foreground">{b.desc}</div>
                {!b.got ? <Progress className="mt-1 h-1" value={b.progress * 100} /> : null}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
