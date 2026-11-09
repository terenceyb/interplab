import { browserDownload, saveBlob } from '@/lib/desktop';
import type { Material, Session } from '@/types';
import { MARKER_MAP, MODE_LABEL } from '@/types';
import { fmtSec } from './metrics';

const BOM = '\uFEFF';

function csvCell(v: string | number | undefined | null): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number)[][]): string {
  return BOM + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function sessionsCsv(sessions: Session[]): string {
  const rows: (string | number)[][] = [
    [
      '训练日期',
      '素材',
      '训练类型',
      '轮次',
      '时长(秒)',
      '时长',
      '录音段数',
      '标记总数',
      '漏译',
      '误译',
      '增译',
      '数字/专名错误',
      '长停顿',
      '填充词',
      '自我修正',
      '重复',
      '语法',
      '用词不当',
      '语速失控',
      'EVS过短',
      'EVS过长',
      '笔记未利用',
      '停顿次数',
      '平均停顿(秒)',
      '发声时间比',
      '语速(WPM/CPM)',
      '覆盖率',
      '内容词重叠',
      '个人备注',
    ],
  ];
  for (const s of sessions) {
    const c = countByType(s);
    const f = s.metrics?.fluency;
    rows.push([
      new Date(s.createdAt).toLocaleString('zh-CN'),
      s.materialTitle,
      MODE_LABEL[s.mode],
      s.attemptNumber,
      Math.round(s.duration),
      fmtSec(s.duration),
      s.attempts.length,
      s.markers.length,
      ...MARKER_ORDER.map((k) => c[k] || 0),
      f?.pauseCount ?? '',
      f?.avgPause ? Number(f.avgPause.toFixed(2)) : '',
      f?.phonationRatio ? Number((f.phonationRatio * 100).toFixed(1)) : '',
      f?.wpm ?? '',
      s.metrics?.coverage?.available && s.metrics.coverage.hitRate != null
        ? Number((s.metrics.coverage.hitRate * 100).toFixed(1))
        : '',
      s.metrics?.fidelity?.available && s.metrics.fidelity.tokenOverlap != null
        ? Number((s.metrics.fidelity.tokenOverlap * 100).toFixed(1))
        : '',
      s.note || '',
    ]);
  }
  return toCsv(rows);
}

export const MARKER_ORDER = [
  'omission',
  'mistranslation',
  'addition',
  'number-entity',
  'long-pause',
  'filler',
  'self-repair',
  'repetition',
  'grammar',
  'wording',
  'pace',
  'evs-short',
  'evs-long',
  'note-unused',
];

function countByType(s: Session): Record<string, number> {
  const c: Record<string, number> = {};
  for (const m of s.markers) c[m.type] = (c[m.type] || 0) + 1;
  return c;
}

export function markersCsv(sessions: Session[]): string {
  const rows: (string | number)[][] = [['训练日期', '素材', '训练类型', '轮次', '时间锚点', '时间点', '问题类型', '分类', '备注']];
  for (const s of sessions) {
    for (const m of [...s.markers].sort((a, b) => a.t - b.t)) {
      const def = MARKER_MAP[m.type];
      rows.push([
        new Date(s.createdAt).toLocaleString('zh-CN'),
        s.materialTitle,
        MODE_LABEL[s.mode],
        s.attemptNumber,
        Number(m.t.toFixed(2)),
        fmtSec(m.t),
        def?.label || m.type,
        def?.category || '',
        m.note || '',
      ]);
    }
  }
  return toCsv(rows);
}

export interface ExportBundle {
  version: 1;
  exportedAt: string;
  materials: Material[];
  sessions: Session[];
  glossary: unknown[];
  vocab: unknown[];
  plan: unknown[];
  profile: unknown;
}

export function buildBundle(
  materials: Material[],
  sessions: Session[],
  glossary: unknown[],
  vocab: unknown[],
  plan: unknown[],
  profile: unknown,
): ExportBundle {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    materials: materials.map((m) => ({ ...m })),
    sessions: sessions.map((s) => ({ ...s })),
    glossary,
    vocab,
    plan,
    profile,
  };
}

export async function download(name: string, content: string | Blob, mime = 'text/plain') {
  const blob = typeof content === 'string' ? new Blob([content], { type: `${mime};charset=utf-8` }) : content;
  // 桌面版走原生「另存为」，浏览器继续用 a[download]
  const outcome = await saveBlob(name, blob);
  if (outcome !== 'unsupported') return outcome;
  browserDownload(name, blob);
  return 'saved' as const;
}

export function reportText(s: Session, m?: Material): string {
  const f = s.metrics?.fluency;
  const cov = s.metrics?.coverage;
  const fid = s.metrics?.fidelity;
  const byType = countByType(s);
  const lines: string[] = [];
  lines.push(`InterpLab 复盘报告`);
  lines.push(`生成时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push(`素材：${s.materialTitle}`);
  lines.push(`训练类型：${MODE_LABEL[s.mode]}  轮次：第 ${s.attemptNumber} 轮`);
  lines.push(`训练日期：${new Date(s.createdAt).toLocaleString('zh-CN')}  时长：${fmtSec(s.duration)}`);
  if (m) lines.push(`素材标签：${[m.difficulty, m.accent, m.speechRate, ...(m.tags || [])].filter(Boolean).join(' / ')}`);
  lines.push('');
  lines.push('【标记统计】');
  if (s.markers.length === 0) lines.push('本轮未添加时间锚点标记。');
  for (const [k, v] of Object.entries(byType)) {
    lines.push(`- ${MARKER_MAP[k]?.label || k}：${v} 处`);
  }
  lines.push('');
  lines.push('【自动线索（仅供参考，不代表评分）】');
  if (f) {
    lines.push(
      `- 流利度：停顿 ${f.pauseCount} 次，平均停顿 ${f.avgPause.toFixed(2)} 秒，发声时间比 ${(f.phonationRatio * 100).toFixed(1)}%${f.wpm ? `，语速约 ${f.wpm}` : ''}`,
    );
    if (f.longPausePositions.length) {
      lines.push(`- 长停顿（≥1.5s）位置：${f.longPausePositions.map((t) => fmtSec(t)).join('、')}`);
    }
  }
  if (cov?.available) {
    lines.push(`- 覆盖率：关键实体命中 ${cov.entities.filter((e) => e.hit).length}/${cov.entities.length}`);
    const miss = cov.entities.filter((e) => !e.hit).map((e) => e.text);
    if (miss.length) lines.push(`  未命中：${miss.slice(0, 12).join('、')}`);
  } else lines.push(`- 覆盖率：${cov?.reason || '不可用'}`);
  if (fid?.available) {
    lines.push(`- 忠实度线索：内容词重叠 ${((fid.tokenOverlap || 0) * 100).toFixed(1)}%`);
    if (fid.numberMatch) lines.push(`  数字匹配 ${fid.numberMatch.hit}/${fid.numberMatch.total}`);
    if (fid.riskySpans?.length) {
      lines.push(`  高风险片段：${fid.riskySpans.map((r) => fmtSec(r.start)).join('、')}`);
    }
  } else lines.push(`- 忠实度：${fid?.reason || '不可用'}`);
  lines.push('');
  lines.push('【个人备注】');
  lines.push(s.note?.trim() || '（无）');
  lines.push('');
  lines.push('说明：自动指标仅为回听线索，不能替代自我判断。');
  return lines.join('\n');
}

export async function exportPng(el: HTMLElement, filename: string) {
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
  canvas.toBlob((b) => {
    if (b) download(filename, b, 'image/png');
  }, 'image/png');
}
