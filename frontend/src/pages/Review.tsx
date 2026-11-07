import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookMarked,
  FileImage,
  FileText,
  Headphones,
  Pause,
  Play,
  Printer,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { PageHeader, Section, Empty } from '@/components/PageHeader';
import { DualTrack } from '@/components/Waveform';
import { NotePad } from '@/components/NotePad';
import { useApp, audioUrl } from '@/store/useApp';
import { toast } from 'sonner';
import { DualPlayer } from '@/lib/audio';
import { useHotkeys } from '@/lib/hooks';
import { computeMetrics, fmtSec } from '@/lib/metrics';
import { download, reportText, exportPng } from '@/lib/export';
import { findSentenceIndex } from '@/lib/text';
import * as db from '@/lib/db';
import { CATEGORY_LABEL, MARKER_MAP, MARKER_TYPES, MODE_LABEL } from '@/types';
import type { Attempt, Marker, Session } from '@/types';

export default function Review() {
  const { id } = useParams();
  if (!id) return <ReviewList />;
  return <ReviewDetail sessionId={id} />;
}

/* ---------------- 列表 ---------------- */

function ReviewList() {
  const { sessions, materials, removeSession } = useApp();
  const nav = useNavigate();
  const [kw, setKw] = useState('');
  const [mode, setMode] = useState<string>('all');
  const [mat, setMat] = useState<string>('all');

  const list = sessions.filter((s) => {
    if (mode !== 'all' && s.mode !== mode) return false;
    if (mat !== 'all' && s.materialId !== mat) return false;
    if (kw.trim() && !s.materialTitle.toLowerCase().includes(kw.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <PageHeader title="训练记录" desc="按素材、训练类型、日期筛选；可继续复盘、重练或删除。" />
      <div className="mx-6 mt-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-56 pl-8" placeholder="搜索素材名" value={kw} onChange={(e) => setKw(e.target.value)} />
        </div>
        <Select value={mode} onValueChange={setMode}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {Object.entries(MODE_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={mat} onValueChange={setMat}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部素材</SelectItem>
            {materials.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">共 {list.length} 条记录</span>
      </div>

      <div className="space-y-2 p-6">
        {list.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <button className="truncate text-sm font-medium hover:underline" onClick={() => nav(`/review/${s.id}`)}>
                  {s.materialTitle}
                </button>
                <Badge variant="secondary" className="text-[11px]">
                  {MODE_LABEL[s.mode]}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  第 {s.attemptNumber} 轮
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{new Date(s.createdAt).toLocaleString('zh-CN')}</span>
                <span>时长 {fmtSec(s.duration)}</span>
                <span>录音 {s.attempts.length} 段</span>
                <span>标记 {s.markers.length} 处</span>
                {s.metrics?.fluency ? (
                  <span>
                    停顿 {s.metrics.fluency.pauseCount} 次 · 平均 {s.metrics.fluency.avgPause.toFixed(2)}s
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => nav(`/review/${s.id}`)}>
                继续复盘
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => nav(`/train/${s.mode === 'consecutive' ? 'consecutive' : s.mode}/${s.materialId}`)}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> 重练
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => {
                  if (confirm('删除该训练记录及其录音？')) removeSession(s.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
        {!list.length ? (
          <Empty text="还没有训练记录，先从素材库选一段音频开始练习" action={<Button onClick={() => nav('/library')}>去素材库</Button>} />
        ) : null}
      </div>
    </>
  );
}

/* ---------------- 详情 ---------------- */

function ReviewDetail({ sessionId }: { sessionId: string }) {
  const { sessions, materials, terms, saveSession, removeSession, saveVocab } = useApp();
  const nav = useNavigate();
  const session = sessions.find((s) => s.id === sessionId);
  const material = materials.find((m) => m.id === session?.materialId);

  if (!session) {
    return (
      <div className="p-6">
        <Empty text="记录不存在或已删除" action={<Button onClick={() => nav('/review')}>返回列表</Button>} />
      </div>
    );
  }
  return <Detail key={session.id} session={session} material={material} terms={terms.map((t) => t.term)} saveSession={saveSession} removeSession={removeSession} sessions={sessions} nav={nav} saveVocab={saveVocab} />;
}

function Detail({
  session,
  material,
  terms,
  saveSession,
  removeSession,
  sessions,
  nav,
  saveVocab,
}: {
  session: Session;
  material?: import('@/types').Material;
  terms: string[];
  saveSession: (s: Session) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  sessions: Session[];
  nav: (p: string) => void;
  saveVocab: (v: any) => Promise<void>;
}) {
  const [segIdx, setSegIdx] = useState(0);
  const [playMode, setPlayMode] = useState<'source' | 'user' | 'mix' | 'split'>('mix');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [swap, setSwap] = useState(false);
  const [markers, setMarkers] = useState<Marker[]>(session.markers);
  const [filterCat, setFilterCat] = useState<string>('all');
  const [markType, setMarkType] = useState('omission');
  const [note, setNote] = useState(session.note || '');
  const [noteReplay, setNoteReplay] = useState(false);
  const [transcript, setTranscript] = useState(session.attempts[0]?.transcript || '');
  const [compareId, setCompareId] = useState('');
  const [metrics, setMetrics] = useState(session.metrics);
  const playerRef = useRef<DualPlayer | null>(null);
  const [srcUrl, setSrcUrl] = useState('');
  const [att, setAtt] = useState<Attempt | null>(session.attempts[0] || null);
  const reportRef = useRef<HTMLDivElement>(null);

  const isConsecutive = session.mode === 'consecutive';
  const seg = session.segments[segIdx];

  /* 当前聚焦的录音：交传按段，其余整段 */
  useEffect(() => {
    setAtt(session.attempts.find((a) => a.segmentIndex === seg?.index) || session.attempts[0] || null);
  }, [segIdx, session.attempts, seg?.index]);

  useEffect(() => {
    if (material) audioUrl(material.audioKey).then(setSrcUrl);
  }, [material]);

  const userUrlRef = useRef('');
  const [userUrl, setUserUrl] = useState('');
  useEffect(() => {
    if (!att) return;
    audioUrl(att.audioKey).then((u) => {
      userUrlRef.current = u;
      setUserUrl(u);
    });
  }, [att]);

  /* 构建双轨播放器 */
  useEffect(() => {
    if (!srcUrl || !att) return;
    const offset = isConsecutive ? att.sourceStart : att.sourceStart;
    const mapToUser = (t: number) => {
      const u = t - offset;
      return u >= 0 && u <= att.duration ? u : null;
    };
    const p = new DualPlayer({
      srcUrl,
      userUrl: userUrl || undefined,
      trimStart: material?.trim.start ?? 0,
      trimEnd: material?.trim.end ?? Infinity,
      mapToUser,
      onTick: (t) => setTime(t),
      onEnd: () => setPlaying(false),
    });
    playerRef.current = p;
    return () => {
      p.destroy();
      playerRef.current = null;
    };
  }, [srcUrl, userUrl, att, isConsecutive, material?.trim.start, material?.trim.end]);

  useEffect(() => {
    playerRef.current?.setMode(playMode);
  }, [playMode]);
  useEffect(() => {
    playerRef.current?.setRate(rate);
  }, [rate]);
  useEffect(() => {
    playerRef.current?.setSwap(swap);
  }, [swap]);

  const persist = async (patch: Partial<Session>) => {
    await saveSession({ ...session, ...patch });
  };

  const addMarker = (type: string) => {
    const m: Marker = { id: db.uid(), sessionId: session.id, t: time, type, createdAt: Date.now() };
    const next = [...markers, m];
    setMarkers(next);
    persist({ markers: next });
  };

  const removeMarker = (id: string) => {
    const next = markers.filter((m) => m.id !== id);
    setMarkers(next);
    persist({ markers: next });
  };

  useHotkeys(
    {
      ' ': () => {
        const p = playerRef.current;
        if (!p) return;
        if (playing) {
          p.pause();
          setPlaying(false);
        } else {
          p.play();
          setPlaying(true);
        }
      },
      m: () => addMarker(markType),
      '1': () => addMarker('omission'),
      '2': () => addMarker('mistranslation'),
      '3': () => addMarker('long-pause'),
      '4': () => addMarker('evs-short'),
      arrowleft: () => playerRef.current?.seek(Math.max(0, time - 5)),
      arrowright: () => playerRef.current?.seek(time + 5),
      s: () => setPlayMode((m2) => (m2 === 'source' ? 'user' : m2 === 'user' ? 'mix' : m2 === 'mix' ? 'split' : 'source')),
    },
    true,
  );

  /* 自动线索 */
  const sourceTextFor = (a: Attempt | null) => {
    if (!material || !a) return '';
    return material.sentences
      .filter((s) => s.start < a.sourceEnd && s.end > a.sourceStart)
      .map((s) => s.text)
      .join(' ');
  };

  const recompute = async () => {
    if (!att) return;
    const result = computeMetrics({
      attempt: { ...att, transcript },
      sourceStart: att.sourceStart,
      sourceText: sourceTextFor(att),
      sentences: material?.sentences,
      glossary: terms,
    });
    setMetrics(result);
    const attempts = session.attempts.map((a) => (a.id === att.id ? { ...a, transcript } : a));
    await saveSession({ ...session, metrics: result, attempts });
  };

  const filtered = markers.filter((m) => filterCat === 'all' || MARKER_MAP[m.type]?.category === filterCat);
  const prevSession = useMemo(
    () =>
      sessions
        .filter((s) => s.materialId === session.materialId && s.mode === session.mode && s.createdAt < session.createdAt)
        .sort((a, b) => b.createdAt - a.createdAt)[0],
    [sessions, session],
  );

  const stats = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of markers) c[m.type] = (c[m.type] || 0) + 1;
    return c;
  }, [markers]);

  const curSentenceIdx = material ? findSentenceIndex(material.sentences, time) : -1;

  if (!material) return <div className="p-6 text-sm text-muted-foreground">素材已删除</div>;

  return (
    <>
      <PageHeader
        className="no-print"
        title={`复盘 · ${session.materialTitle}`}
        desc={`${MODE_LABEL[session.mode]} · 第 ${session.attemptNumber} 轮 · ${new Date(session.createdAt).toLocaleString('zh-CN')} · 时长 ${fmtSec(session.duration)}`}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => nav('/review')}>
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 返回列表
            </Button>
            <Button size="sm" variant="outline" onClick={() => reportRef.current && exportPng(reportRef.current, `复盘报告-${session.materialTitle}-第${session.attemptNumber}轮.png`)}>
              <FileImage className="mr-1 h-3.5 w-3.5" /> 报告图片
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1 h-3.5 w-3.5" /> 打印 / PDF
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => download(`复盘报告-${session.materialTitle}-第${session.attemptNumber}轮.txt`, reportText({ ...session, markers, metrics }, material), 'text/plain')}
            >
              <FileText className="mr-1 h-3.5 w-3.5" /> 文本摘要
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                if (confirm('删除该训练记录及其录音？')) {
                  removeSession(session.id);
                  nav('/review');
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        }
      />

      <div className="grid gap-4 p-6 lg:grid-cols-4">
        <div className="no-print space-y-4 lg:col-span-3">
          {/* 双轨回放 */}
          <Section
            title="双轨同步回放"
            desc="上下两轨共享时间轴，播放头同步移动。空格播放/暂停，←/→ 跳转 5 秒，S 切换播放模式，M 添加标记。"
            actions={
              <div className="flex flex-wrap items-center gap-1">
                {(['source', 'user', 'mix', 'split'] as const).map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    variant={playMode === m ? 'default' : 'outline'}
                    onClick={() => setPlayMode(m)}
                  >
                    {m === 'source' ? '源语' : m === 'user' ? '译语' : m === 'mix' ? '混合' : '双耳分听'}
                  </Button>
                ))}
                {playMode === 'split' ? (
                  <Button size="sm" variant={swap ? 'default' : 'outline'} onClick={() => setSwap((v) => !v)}>
                    <Headphones className="mr-1 h-3.5 w-3.5" />
                    {swap ? '右源/左译' : '左源/右译'}
                  </Button>
                ) : null}
              </div>
            }
          >
            {att ? (
              <DualTrack
                srcPeaks={material.peaks}
                srcDuration={Math.max(0, material.trim.end - material.trim.start)}
                userPeaks={att.peaks}
                userDuration={att.duration}
                userOffset={att.sourceStart}
                cursor={time}
                markers={filtered.map((m) => ({
                  t: m.t,
                  color: MARKER_MAP[m.type]?.color || '#f97316',
                  label: MARKER_MAP[m.type]?.label,
                }))}
                segments={
                  isConsecutive
                    ? session.segments.map((s) => ({ start: s.start, end: s.end, label: `#${s.index + 1}` }))
                    : []
                }
                onSeek={(t) => playerRef.current?.seek(t)}
              />
            ) : (
              <p className="text-xs text-muted-foreground">该轮没有录音</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  const p = playerRef.current;
                  if (!p) return;
                  if (playing) {
                    p.pause();
                    setPlaying(false);
                  } else {
                    p.play();
                    setPlaying(true);
                  }
                }}
              >
                {playing ? <Pause className="mr-1 h-3.5 w-3.5" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                {playing ? '暂停' : '播放'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => playerRef.current?.seek(Math.max(0, time - 5))}>
                -5s
              </Button>
              <Button size="sm" variant="outline" onClick={() => playerRef.current?.seek(time + 5)}>
                +5s
              </Button>
              <Select value={String(rate)} onValueChange={(v) => setRate(Number(v))}>
                <SelectTrigger className="h-8 w-[76px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0.75, 1, 1.25, 1.5].map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {r}×
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                播放头 {fmtSec(time)} · 段落 {isConsecutive ? `#${(seg?.index ?? 0) + 1}` : '整段'}
              </span>
            </div>

            {isConsecutive ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {session.segments.map((s, i) => (
                  <Button
                    key={s.index}
                    size="sm"
                    variant={i === segIdx ? 'default' : 'outline'}
                    onClick={() => {
                      setSegIdx(i);
                      setTimeout(() => playerRef.current?.seek(s.start), 60);
                    }}
                  >
                    #{i + 1} · {(s.end - s.start).toFixed(0)}s
                  </Button>
                ))}
              </div>
            ) : null}
          </Section>

          {/* 标记 */}
          <Section
            title="时间锚点标记"
            desc="在波形上点击定位后按 M（或点下方按钮）添加标记；按问题类型筛选可快速定位同类问题。"
            actions={
              <Select value={filterCat} onValueChange={setFilterCat}>
                <SelectTrigger className="h-8 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部类型</SelectItem>
                  {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          >
            <div className="flex flex-wrap gap-1.5">
              {MARKER_TYPES.map((t) => (
                <Button
                  key={t.key}
                  size="sm"
                  variant={markType === t.key ? 'default' : 'outline'}
                  className="h-7 text-xs"
                  onClick={() => {
                    setMarkType(t.key);
                    addMarker(t.key);
                  }}
                >
                  <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: t.color }} />
                  {t.label}
                  {t.hot ? <span className="ml-1 text-[10px] opacity-60">{t.hot}</span> : null}
                </Button>
              ))}
            </div>

            <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
              {filtered
                .slice()
                .sort((a, b) => a.t - b.t)
                .map((m) => {
                  const def = MARKER_MAP[m.type];
                  return (
                    <div key={m.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
                      <button
                        className="w-16 shrink-0 text-left tabular-nums text-muted-foreground hover:text-foreground"
                        onClick={() => playerRef.current?.seek(m.t)}
                      >
                        {fmtSec(m.t)}
                      </button>
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px]" style={{ background: `${def?.color}22`, color: def?.color }}>
                        {def?.label || m.type}
                      </span>
                      <Input
                        className="h-6 flex-1 border-transparent bg-transparent px-1 text-xs"
                        placeholder="备注…"
                        defaultValue={m.note || ''}
                        onBlur={(e) => {
                          const next = markers.map((x) => (x.id === m.id ? { ...x, note: e.target.value } : x));
                          setMarkers(next);
                          persist({ markers: next });
                        }}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0"
                        title="加入生词本"
                        onClick={async () => {
                          const word = (m.note || '').trim() || MARKER_MAP[m.type]?.label || m.type;
                          await saveVocab({
                            id: db.uid(),
                            word,
                            note: `来自复盘标记（${MARKER_MAP[m.type]?.label || m.type}）@ ${fmtSec(m.t)}`,
                            from: `${session.materialTitle} 第${session.attemptNumber}轮`,
                            createdAt: Date.now(),
                          });
                          toast.success(`已加入生词本：${word}`);
                        }}
                      >
                        <BookMarked className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => removeMarker(m.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
              {!filtered.length ? (
                <p className="py-4 text-center text-xs text-muted-foreground">还没有标记，点击上方按钮在当前播放位置添加</p>
              ) : null}
            </div>
          </Section>

          {/* 个人备注 */}
          <Section title="个人备注" desc="记录本轮的整体感受与下一步改进点，随记录保存。">
            <Textarea
              className="min-h-[80px] text-xs"
              placeholder="例如：数字转换仍是主要失分点，下次先预判数字单位…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => persist({ note })}
            />
          </Section>
        </div>

        {/* 右列：统计 + 线索 + 导出 */}
        <div className="space-y-4 print-area">
          <div ref={reportRef} className="space-y-4">
            <Section title="标记统计摘要">
              {markers.length ? (
                <div className="space-y-1 text-xs">
                  {Object.entries(stats)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-2 w-2 rounded-full" style={{ background: MARKER_MAP[k]?.color }} />
                          {MARKER_MAP[k]?.label || k}
                        </span>
                        <span className="tabular-nums">
                          {v} 处
                          {prevSession
                            ? (() => {
                                const pv = prevSession.markers.filter((m) => m.type === k).length;
                                const d = v - pv;
                                return (
                                  <span className={`ml-1 ${d > 0 ? 'text-red-500' : d < 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                                    {d > 0 ? `+${d}` : d === 0 ? '±0' : d}
                                  </span>
                                );
                              })()
                            : null}
                        </span>
                      </div>
                    ))}
                  {prevSession ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      对比第 {prevSession.attemptNumber} 轮（同素材同类型，涨红跌绿仅为变化量）
                    </p>
                  ) : (
                    <p className="mt-2 text-[11px] text-muted-foreground">该素材首次训练，暂无往轮对比</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">本轮暂无标记</p>
              )}
            </Section>

            <Section title="自动评估线索" desc="仅提供可解释线索，不给出总分，最终判断权留给你。">
              {metrics?.fluency ? (
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">停顿次数</span>
                    <span className="tabular-nums">{metrics.fluency.pauseCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">平均停顿</span>
                    <span className="tabular-nums">{metrics.fluency.avgPause.toFixed(2)}s</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">发声时间比</span>
                    <span className="tabular-nums">{(metrics.fluency.phonationRatio * 100).toFixed(1)}%</span>
                  </div>
                  {metrics.fluency.wpm ? (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">语速</span>
                      <span className="tabular-nums">{metrics.fluency.wpm}</span>
                    </div>
                  ) : null}
                  {metrics.fluency.longPausePositions.length ? (
                    <div className="pt-1">
                      <div className="text-muted-foreground">长停顿（≥1.5s）</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {metrics.fluency.longPausePositions.map((t, i) => (
                          <button key={i} className="rounded bg-muted px-1.5 py-0.5 tabular-nums hover:bg-accent" onClick={() => playerRef.current?.seek(t)}>
                            {fmtSec(t)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">尚未计算</p>
              )}

              <div className="mt-3 space-y-2 border-t pt-3 text-xs">
                {metrics?.coverage?.available ? (
                  <div>
                    <div className="mb-1 flex justify-between">
                      <span className="text-muted-foreground">覆盖率线索</span>
                      <span className="tabular-nums">
                        {metrics.coverage.entities.filter((e) => e.hit).length}/{metrics.coverage.entities.length}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {metrics.coverage.entities.slice(0, 20).map((e) => (
                        <span
                          key={e.text}
                          className={`rounded px-1.5 py-0.5 ${e.hit ? 'bg-emerald-100 text-emerald-700' : 'bg-red-50 text-red-600 line-through'}`}
                        >
                          {e.text}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground">覆盖率：{metrics?.coverage?.reason || '需要源语文本与译语转写'}</p>
                )}

                {metrics?.fidelity?.available ? (
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">内容词重叠</span>
                      <span className="tabular-nums">{((metrics.fidelity.tokenOverlap || 0) * 100).toFixed(1)}%</span>
                    </div>
                    {metrics.fidelity.numberMatch ? (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">数字匹配</span>
                        <span className="tabular-nums">
                          {metrics.fidelity.numberMatch.hit}/{metrics.fidelity.numberMatch.total}
                        </span>
                      </div>
                    ) : null}
                    {metrics.fidelity.riskySpans?.length ? (
                      <div>
                        <div className="text-muted-foreground">高风险片段</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {metrics.fidelity.riskySpans.map((r, i) => (
                            <button key={i} className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 hover:bg-amber-200" onClick={() => playerRef.current?.seek(r.start)} title={r.reason}>
                              {fmtSec(r.start)}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-muted-foreground">忠实度：{metrics?.fidelity?.reason || '需要源语文本与译语转写'}</p>
                )}
              </div>

              <div className="mt-3 space-y-2 border-t pt-3">
                <Label className="text-xs">译语转写（可选，用于覆盖率/忠实度线索）</Label>
                <Textarea
                  className="min-h-[70px] text-xs"
                  placeholder="粘贴你译出内容的文本…"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                />
                <Button size="sm" variant="outline" className="w-full" onClick={recompute}>
                  <RefreshCw className="mr-1 h-3.5 w-3.5" /> 重新计算线索
                </Button>
              </div>
              {!metrics ? (
                <Button size="sm" className="mt-2 w-full" onClick={recompute}>
                  计算自动线索
                </Button>
              ) : null}
            </Section>
          </div>

          {/* 回炉对比 */}
          <Section className="no-print" title="回炉对比">
            <Select value={compareId} onValueChange={setCompareId}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="选择对比轮次" />
              </SelectTrigger>
              <SelectContent>
                {sessions
                  .filter((s) => s.materialId === session.materialId && s.id !== session.id)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {MODE_LABEL[s.mode]} · 第 {s.attemptNumber} 轮 · {new Date(s.createdAt).toLocaleDateString('zh-CN')}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {compareId ? (
              <ComparePanel a={session} b={sessions.find((s) => s.id === compareId)!} />
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">选择同一素材的其他轮次，对比流利度线索与标记分布。</p>
            )}
          </Section>

          {/* 笔记回放 */}
          {att?.strokes?.length ? (
            <Section
              className="no-print"
              title="笔记回放"
              desc="笔记按时间戳逐笔重现，与源语播放同步，审视哪些记录真正被用到。"
              actions={
                <div className="flex items-center gap-2">
                  <Label className="text-xs">开启</Label>
                  <Switch checked={noteReplay} onCheckedChange={setNoteReplay} />
                </div>
              }
            >
              {noteReplay ? (
                <NotePad
                  strokes={att.strokes}
                  readOnly
                  current={Math.max(0, time - att.sourceStart)}
                  height={160}
                />
              ) : (
                <p className="text-xs text-muted-foreground">本段共 {att.strokes.length} 笔，开启后随播放重现。</p>
              )}
            </Section>
          ) : null}

          {/* 稿件联动（带稿同传） */}
          {material.sentences.length && !isConsecutive ? (
            <Section title="稿件联动">
              <div className="max-h-48 overflow-y-auto text-xs leading-relaxed">
                {material.sentences.map((s, i) => (
                  <span
                    key={s.id}
                    className={i === curSentenceIdx ? 'rounded bg-primary/20 font-medium' : ''}
                  >
                    {s.text}{' '}
                  </span>
                ))}
              </div>
            </Section>
          ) : null}

          {/* EVS 偏差 */}
          {session.evsSamples?.length ? (
            <Section title="EVS 偏差" desc="自报告滞后样本与目标的偏离（实际 EVS 需人工判断）。">
              <EvsChart samples={session.evsSamples} target={session.params.evsTarget || 2} duration={session.duration} />
            </Section>
          ) : null}
        </div>
      </div>
    </>
  );
}

function ComparePanel({ a, b }: { a: Session; b: Session }) {
  const rows: { label: string; x: string; y: string }[] = [
    {
      label: '停顿次数',
      x: String(a.metrics?.fluency?.pauseCount ?? '-'),
      y: String(b.metrics?.fluency?.pauseCount ?? '-'),
    },
    {
      label: '平均停顿',
      x: a.metrics?.fluency ? `${a.metrics.fluency.avgPause.toFixed(2)}s` : '-',
      y: b.metrics?.fluency ? `${b.metrics.fluency.avgPause.toFixed(2)}s` : '-',
    },
    {
      label: '发声时间比',
      x: a.metrics?.fluency ? `${(a.metrics.fluency.phonationRatio * 100).toFixed(0)}%` : '-',
      y: b.metrics?.fluency ? `${(b.metrics.fluency.phonationRatio * 100).toFixed(0)}%` : '-',
    },
    { label: '标记总数', x: String(a.markers.length), y: String(b.markers.length) },
    {
      label: '漏译',
      x: String(a.markers.filter((m) => m.type === 'omission').length),
      y: String(b.markers.filter((m) => m.type === 'omission').length),
    },
  ];
  return (
    <div className="mt-2 space-y-1 text-xs">
      <div className="flex justify-between text-muted-foreground">
        <span>指标</span>
        <span>
          本轮(第{a.attemptNumber}轮) / 对比(第{b.attemptNumber}轮)
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between rounded px-1 py-0.5 odd:bg-muted/50">
          <span>{r.label}</span>
          <span className="tabular-nums">
            {r.x} / {r.y}
          </span>
        </div>
      ))}
    </div>
  );
}

function EvsChart({ samples, target, duration }: { samples: { t: number; lag: number }[]; target: number; duration: number }) {
  const w = 260;
  const h = 90;
  const maxLag = Math.max(target * 2, ...samples.map((s) => s.lag)) || 4;
  const x = (t: number) => (duration ? (t / duration) * w : 0);
  const y = (l: number) => h - (l / maxLag) * h;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      <line x1={0} y1={y(target)} x2={w} y2={y(target)} stroke="#f59e0b" strokeDasharray="4 3" />
      <text x={2} y={y(target) - 3} fontSize={9} fill="#b45309">
        目标 {target}s
      </text>
      <polyline
        fill="none"
        stroke="#0ea5e9"
        strokeWidth={1.5}
        points={samples.map((s) => `${x(s.t)},${y(s.lag)}`).join(' ')}
      />
      {samples.map((s, i) => (
        <circle key={i} cx={x(s.t)} cy={y(s.lag)} r={2} fill="#0ea5e9" />
      ))}
    </svg>
  );
}
