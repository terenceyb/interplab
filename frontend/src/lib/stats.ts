import type { PlanGoal, Session } from '@/types';
import { MODE_LABEL } from '@/types';

export const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/** 连续训练天数（含今天或昨天起算） */
export function computeStreak(sessions: Session[]): number {
  const days = new Set(sessions.map((s) => dayKey(s.createdAt)));
  if (!days.size) return 0;
  let streak = 0;
  const cursor = new Date();
  // 若今天没练，从昨天开始算
  if (!days.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  for (let i = 0; i < 365; i++) {
    if (days.has(dayKey(cursor.getTime()))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }
  return streak;
}

export function weekStart(t = Date.now()): number {
  const d = new Date(t);
  const day = (d.getDay() + 6) % 7; // 周一为一周起点
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

export function monthStart(t = Date.now()): number {
  const d = new Date(t);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function goalProgress(goal: PlanGoal, sessions: Session[]): { done: number; target: number } {
  const from = goal.period === 'week' ? weekStart() : monthStart();
  const done = sessions.filter((s) => {
    if (s.createdAt < from) return false;
    return goal.mode === 'review' ? (s.metrics ? true : s.markers.length > 0) : s.mode === goal.mode;
  }).length;
  return { done, target: goal.target };
}

export interface Badge {
  key: string;
  label: string;
  desc: string;
  got: boolean;
  progress: number; // 0-1
}

export function computeBadges(sessions: Session[]): Badge[] {
  const totalSec = sessions.reduce((s, x) => s + x.duration, 0);
  const reviewed = sessions.filter((s) => s.markers.length > 0).length;
  const rounds = sessions.length;
  const mk = (key: string, label: string, desc: string, cur: number, need: number): Badge => ({
    key,
    label,
    desc,
    got: cur >= need,
    progress: need ? Math.min(1, cur / need) : 0,
  });
  return [
    mk('streak3', '连续 3 天', '连续训练 3 天', computeStreak(sessions), 3),
    mk('streak7', '连续 7 天', '连续训练 7 天', computeStreak(sessions), 7),
    mk('streak30', '连续 30 天', '连续训练 30 天', computeStreak(sessions), 30),
    mk('hours1', '累计 1 小时', '累计训练时长 1 小时', totalSec, 3600),
    mk('hours10', '累计 10 小时', '累计训练时长 10 小时', totalSec, 36000),
    mk('review10', '复盘 10 次', '完成 10 次带标记的复盘', reviewed, 10),
    mk('round50', '训练 50 轮', '累计完成 50 轮训练', rounds, 50),
  ];
}

/** 素材多轮趋势 */
export function materialTrend(sessions: Session[], materialId: string) {
  return sessions
    .filter((s) => s.materialId === materialId && s.metrics?.fluency)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((s) => ({
      label: `第${s.attemptNumber}轮`,
      mode: MODE_LABEL[s.mode],
      avgPause: Number((s.metrics!.fluency.avgPause || 0).toFixed(2)),
      pauseCount: s.metrics!.fluency.pauseCount,
      phonation: Number(((s.metrics!.fluency.phonationRatio || 0) * 100).toFixed(1)),
      markers: s.markers.length,
      date: new Date(s.createdAt).toLocaleDateString('zh-CN'),
    }));
}

/** 问题类型分布 */
export function markerDistribution(sessions: Session[]) {
  const c: Record<string, number> = {};
  for (const s of sessions) for (const m of s.markers) c[m.type] = (c[m.type] || 0) + 1;
  return Object.entries(c)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}
