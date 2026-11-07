import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader, Section, Empty } from '@/components/PageHeader';
import { useApp } from '@/store/useApp';
import { computeBadges, computeStreak, goalProgress, markerDistribution, materialTrend } from '@/lib/stats';
import { fmtSec } from '@/lib/metrics';
import * as db from '@/lib/db';
import { MARKER_MAP, MODE_LABEL } from '@/types';
import type { PlanGoal, TrainMode } from '@/types';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const PIE_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#a855f7', '#f43f5e', '#84cc16', '#6366f1', '#0ea5e9', '#14b8a6', '#94a3b8'];

export default function Growth() {
  const { sessions, materials, plan, setPlan } = useApp();
  const [matId, setMatId] = useState('');
  const [newGoal, setNewGoal] = useState<{ mode: TrainMode | 'review'; target: number; period: 'week' | 'month' }>({
    mode: 'consecutive',
    target: 3,
    period: 'week',
  });

  const trend = useMemo(() => (matId ? materialTrend(sessions, matId) : []), [sessions, matId]);
  const dist = useMemo(() => markerDistribution(sessions), [sessions]);
  const badges = useMemo(() => computeBadges(sessions), [sessions]);
  const streak = computeStreak(sessions);

  const weekly = useMemo(() => {
    const buckets: Record<string, number> = {};
    for (let i = 7; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      buckets[d.toISOString().slice(5, 10)] = 0;
    }
    for (const s of sessions) {
      const k = new Date(s.createdAt).toISOString().slice(5, 10);
      if (k in buckets) buckets[k] += s.duration / 60;
    }
    return Object.entries(buckets).map(([d, v]) => ({ date: d, minutes: Number(v.toFixed(1)) }));
  }, [sessions]);

  const byMaterial = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of sessions) m[s.materialTitle] = (m[s.materialTitle] || 0) + s.duration / 60;
    return Object.entries(m)
      .map(([name, minutes]) => ({ name: name.slice(0, 12), minutes: Number(minutes.toFixed(1)) }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 8);
  }, [sessions]);

  const addGoal = async () => {
    const g: PlanGoal = { id: db.uid(), ...newGoal };
    await setPlan([...plan, g]);
  };

  return (
    <>
      <PageHeader title="个人成长追踪" desc="同一素材多轮对比、问题类型分布、训练目标与成就。全部数据仅本人可见。" />

      <div className="grid gap-4 p-6 lg:grid-cols-2">
        <Section
          title="同一素材多轮趋势"
          desc="流利度线索随轮次的变化（平均停顿 / 停顿次数 / 发声时间比）。"
          actions={
            <Select value={matId} onValueChange={setMatId}>
              <SelectTrigger className="h-8 w-48">
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
          }
        >
          {trend.length >= 2 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="avgPause" name="平均停顿(s)" stroke="#ef4444" />
                <Line type="monotone" dataKey="pauseCount" name="停顿次数" stroke="#3b82f6" />
                <Line type="monotone" dataKey="phonation" name="发声时间比(%)" stroke="#22c55e" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty
              text={
                matId
                  ? '该素材至少需要 2 轮带自动线索的训练记录才能生成趋势'
                  : '选择一个素材查看多轮趋势'
              }
            />
          )}
        </Section>

        <Section title="问题类型分布" desc="累计所有训练记录中的标记，定位你的高频问题。">
          {dist.length ? (
            <div className="grid grid-cols-2 gap-2">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={dist} dataKey="count" nameKey="type" outerRadius={80} label={false}>
                    {dist.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number, n: string) => [`${v} 处`, MARKER_MAP[n]?.label || n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="max-h-[220px] space-y-1 overflow-y-auto text-xs">
                {dist.map((d, i) => (
                  <div key={d.type} className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      {MARKER_MAP[d.type]?.label || d.type}
                    </span>
                    <span className="tabular-nums">{d.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Empty text="还没有问题标记，复盘时添加锚点标记后会在此汇总" />
          )}
        </Section>

        <Section title="近 8 周/日训练时长" desc="按自然日统计的源语有效训练时长（分钟）。">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={weekly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Bar dataKey="minutes" name="分钟" fill="#6366f1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Section>

        <Section title="素材累计训练时长" desc="找出你投入最多的素材。">
          {byMaterial.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byMaterial} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" fontSize={11} />
                <YAxis type="category" dataKey="name" fontSize={11} width={90} />
                <Tooltip />
                <Bar dataKey="minutes" name="分钟" fill="#0ea5e9" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty text="还没有训练数据" />
          )}
        </Section>

        <Section
          title="训练计划与目标"
          desc="所有计划由你自己创建和调整，不设教师布置任务。"
          actions={<Badge variant="secondary">连续 {streak} 天</Badge>}
        >
          <div className="space-y-3">
            {plan.map((g) => {
              const { done, target } = goalProgress(g, sessions);
              return (
                <div key={g.id} className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="flex justify-between text-xs">
                      <span>
                        每{g.period === 'week' ? '周' : '月'} {g.mode === 'review' ? '完成复盘' : MODE_LABEL[g.mode]} {target} 次
                      </span>
                      <span className="tabular-nums">
                        {done}/{target}
                      </span>
                    </div>
                    <Progress className="mt-1 h-2" value={Math.min(100, (done / Math.max(1, target)) * 100)} />
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    onClick={() => setPlan(plan.filter((x) => x.id !== g.id))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
            <div className="flex flex-wrap items-end gap-2 border-t pt-3">
              <div>
                <Label className="text-xs">类型</Label>
                <Select value={newGoal.mode} onValueChange={(v) => setNewGoal({ ...newGoal, mode: v as any })}>
                  <SelectTrigger className="mt-1 h-8 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(MODE_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                    <SelectItem value="review">完成复盘</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">次数</Label>
                <Input
                  className="mt-1 h-8 w-20"
                  type="number"
                  min={1}
                  value={newGoal.target}
                  onChange={(e) => setNewGoal({ ...newGoal, target: Math.max(1, Number(e.target.value)) })}
                />
              </div>
              <div>
                <Label className="text-xs">周期</Label>
                <Select value={newGoal.period} onValueChange={(v) => setNewGoal({ ...newGoal, period: v as any })}>
                  <SelectTrigger className="mt-1 h-8 w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="week">每周</SelectItem>
                    <SelectItem value="month">每月</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={addGoal}>
                <Plus className="mr-1 h-3.5 w-3.5" /> 添加目标
              </Button>
            </div>
          </div>
        </Section>

        <Section title="成就徽章" desc="连续天数、累计时长、复盘次数等个人成就，仅本人可见。">
          <div className="grid grid-cols-3 gap-2">
            {badges.map((b) => (
              <div
                key={b.key}
                className={`rounded-md border px-2 py-2 text-center text-[11px] ${b.got ? 'border-amber-300 bg-amber-50' : 'opacity-55'}`}
              >
                <div className="font-medium">{b.label}</div>
                <div className="text-muted-foreground">{b.desc}</div>
                {!b.got ? <Progress className="mt-1 h-1" value={b.progress * 100} /> : null}
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            累计训练时长 {fmtSec(sessions.reduce((s, x) => s + x.duration, 0))} · 共 {sessions.length} 轮
          </div>
        </Section>
      </div>
    </>
  );
}
