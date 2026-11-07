import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FileJson, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader, Section, Stat } from '@/components/PageHeader';
import { useApp } from '@/store/useApp';
import * as db from '@/lib/db';
import { buildBundle, download, markersCsv, reportText, sessionsCsv } from '@/lib/export';
import { fmtSec } from '@/lib/metrics';
import { MODE_LABEL } from '@/types';

export default function ExportPage() {
  const { sessions, materials, terms, vocab, plan, profile } = useApp();
  const nav = useNavigate();
  const [range, setRange] = useState('all');
  const [withAudio, setWithAudio] = useState(false);
  const [pickSession, setPickSession] = useState('');
  const [logs, setLogs] = useState<{ id: string; at: number; kind: string; count: number }[]>([]);

  useEffect(() => {
    db.getExportLogs().then(setLogs);
  }, []);

  const list = useMemo(() => {
    const now = Date.now();
    const days = range === '7' ? 7 : range === '30' ? 30 : range === '90' ? 90 : 0;
    return sessions.filter((s) => (days ? s.createdAt >= now - days * 864e5 : true));
  }, [sessions, range]);

  const refreshLogs = () => db.getExportLogs().then(setLogs);

  const doExport = async (kind: string, fn: () => void, count: number) => {
    fn();
    await db.logExport(kind, count);
    refreshLogs();
  };

  const exportJson = async () => {
    let bundle = buildBundle(materials, list, terms, vocab, plan, profile);
    if (withAudio) {
      // 附带录音（base64）便于迁移备份，可能体积较大
      const attempts = list.flatMap((s) => s.attempts);
      const audioMap: Record<string, string> = {};
      for (const a of attempts) {
        const blob = await db.getAudio(a.audioKey);
        if (!blob) continue;
        audioMap[a.id] = await blobToBase64(blob);
      }
      bundle = { ...bundle, sessions: list.map((s) => ({ ...s, audioBase64: audioMap } as any)) } as any;
    }
    await doExport(
      '训练记录 JSON',
      () => download(`interplab-训练记录-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2), 'application/json'),
      list.length,
    );
  };

  const markerCount = list.reduce((s, x) => s + x.markers.length, 0);

  return (
    <>
      <PageHeader title="记录导出" desc="导出个人训练记录与复盘报告，便于归档或迁移。数据从本机直接生成，不经过任何服务器。" />

      <div className="grid gap-4 p-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section
            title="训练记录"
            desc="表格版（Excel 可直接打开）与结构化版（可用于备份迁移）"
            actions={
              <Select value={range} onValueChange={setRange}>
                <SelectTrigger className="h-8 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部记录</SelectItem>
                  <SelectItem value="7">近 7 天</SelectItem>
                  <SelectItem value="30">近 30 天</SelectItem>
                  <SelectItem value="90">近 90 天</SelectItem>
                </SelectContent>
              </Select>
            }
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                onClick={() =>
                  doExport(
                    '训练记录 CSV',
                    () => download(`interplab-训练记录-${new Date().toISOString().slice(0, 10)}.csv`, sessionsCsv(list), 'text/csv'),
                    list.length,
                  )
                }
              >
                <FileSpreadsheet className="mr-1 h-4 w-4" /> 导出训练记录 CSV（{list.length} 条）
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  doExport(
                    '标记明细 CSV',
                    () => download(`interplab-标记明细-${new Date().toISOString().slice(0, 10)}.csv`, markersCsv(list), 'text/csv'),
                    markerCount,
                  )
                }
              >
                <FileSpreadsheet className="mr-1 h-4 w-4" /> 导出标记明细 CSV（{markerCount} 处）
              </Button>
              <Button variant="outline" onClick={exportJson}>
                <FileJson className="mr-1 h-4 w-4" /> 导出全量 JSON
              </Button>
              <div className="flex items-center gap-2 rounded-md border px-3">
                <Checkbox checked={withAudio} onCheckedChange={(v) => setWithAudio(!!v)} id="wa" />
                <Label htmlFor="wa" className="text-xs">
                  JSON 内含录音音频（base64，体积较大）
                </Label>
              </div>
            </div>
            <div className="mt-3 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <div className="mb-1 font-medium text-foreground">CSV 字段说明</div>
              训练记录表：日期、素材、训练类型、轮次、时长、录音段数、各类问题标记数、流利度线索（停顿次数/平均停顿/发声时间比/语速）、覆盖率、内容词重叠、个人备注。
              标记明细表：每条时间锚点的时间点、问题类型、分类与备注。文件带 UTF-8 BOM，Excel 打开不乱码。
            </div>
          </Section>

          <Section title="复盘报告" desc="选择一条训练记录，导出个人学习报告（文本摘要 / 打印为 PDF / 图片在复盘页导出）。">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[240px] flex-1">
                <Label className="text-xs">训练记录</Label>
                <Select value={pickSession} onValueChange={setPickSession}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="选择记录" />
                  </SelectTrigger>
                  <SelectContent>
                    {sessions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.materialTitle} · {MODE_LABEL[s.mode]} · 第 {s.attemptNumber} 轮 ·{' '}
                        {new Date(s.createdAt).toLocaleDateString('zh-CN')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                disabled={!pickSession}
                onClick={() => {
                  const s = sessions.find((x) => x.id === pickSession);
                  if (!s) return;
                  doExport(
                    '复盘报告文本',
                    () => download(`复盘报告-${s.materialTitle}-第${s.attemptNumber}轮.txt`, reportText(s, materials.find((m) => m.id === s.materialId)), 'text/plain'),
                    1,
                  );
                }}
              >
                <FileText className="mr-1 h-4 w-4" /> 导出文本摘要
              </Button>
              <Button variant="outline" disabled={!pickSession} onClick={() => nav(`/review/${pickSession}`)}>
                <Printer className="mr-1 h-4 w-4" /> 去复盘页打印 / 存图
              </Button>
            </div>
          </Section>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="可导出记录" value={list.length} />
            <Stat label="标记总数" value={markerCount} />
            <Stat label="累计时长" value={fmtSec(list.reduce((s, x) => s + x.duration, 0))} />
            <Stat label="素材数" value={materials.length} />
          </div>

          <Section title="导出历史">
            <div className="space-y-1 text-xs">
              {logs.map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded px-1 py-0.5 odd:bg-muted/50">
                  <span className="flex items-center gap-1.5">
                    <Download className="h-3 w-3 text-muted-foreground" />
                    {l.kind}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {l.count} 条 · {new Date(l.at).toLocaleString('zh-CN')}
                  </span>
                </div>
              ))}
              {!logs.length ? <p className="text-muted-foreground">还没有导出记录</p> : null}
            </div>
          </Section>

          <Section title="说明">
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>· 所有导出均在本机浏览器生成，不上传任何服务器。</li>
              <li>· CSV 适合用 Excel / 数字表格查看与再做统计。</li>
              <li>· JSON 适合备份与迁移；默认不含音频，勾选后附带录音 base64。</li>
              <li>· 复盘报告为个人归档用途，不含社交分享功能。</li>
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
