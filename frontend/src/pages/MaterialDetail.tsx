import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  BookMarked,
  Check,
  Flag,
  Gauge,
  Merge,
  Play,
  Pause,
  Scissors,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Waves,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader, Section, Empty } from '@/components/PageHeader';
import { Waveform } from '@/components/Waveform';
import { useApp } from '@/store/useApp';
import { useAudioUrl, useSourcePlayer, getVA } from '@/lib/hooks';
import { clipActivity, mergeAt, smartSegment, splitSegment, estimateRate } from '@/lib/vad';
import { alignScript, calibrateSentence, extractCandidates, hasTimecodes } from '@/lib/text';
import { fmtSec } from '@/lib/metrics';
import * as db from '@/lib/db';
import type { Material, Segment, SegmentParams } from '@/types';

const DEFAULT_PARAMS: SegmentParams = {
  target: 60,
  floatPct: 0.2,
  minSeg: 15,
  maxSeg: 120,
  preference: 'balance',
};

export default function MaterialDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { materials, saveMaterial, removeMaterial, libs, terms, saveTerm } = useApp();
  const material = materials.find((m) => m.id === id);
  const url = useAudioUrl(material?.audioKey);

  if (!material) {
    return (
      <div className="p-6">
        <Empty text="素材不存在或已被删除" action={<Button onClick={() => nav('/library')}>返回素材库</Button>} />
      </div>
    );
  }
  return <Detail key={material.id} material={material} url={url} save={saveMaterial} remove={removeMaterial} libs={libs} terms={terms} saveTerm={saveTerm} nav={nav} />;
}

function Detail({
  material,
  url,
  save,
  remove,
  libs,
  terms,
  saveTerm,
  nav,
}: {
  material: Material;
  url: string;
  save: (m: Material) => Promise<void>;
  remove: (id: string) => Promise<void>;
  libs: { id: string; name: string }[];
  terms: { term: string }[];
  saveTerm: (t: any) => Promise<void>;
  nav: (p: string) => void;
}) {
  const [m, setM] = useState<Material>(material);
  useEffect(() => setM(material), [material]);
  const effDur = Math.max(0, m.trim.end - m.trim.start);
  const player = useSourcePlayer(url, m.trim.start, m.trim.end);
  const [tagInput, setTagInput] = useState('');
  const [params, setParams] = useState<SegmentParams>(DEFAULT_PARAMS);
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [computing, setComputing] = useState(false);
  const [scriptDraft, setScriptDraft] = useState(m.script || '');
  const [candidates, setCandidates] = useState<{ text: string; kind: string; count: number }[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [libId, setLibId] = useState(libs[0]?.id || '');
  const [calibIndex, setCalibIndex] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = async (patch: Partial<Material>) => {
    const next = { ...m, ...patch };
    setM(next);
    await save(next);
  };

  /* 分段 */
  const runSegment = async () => {
    setComputing(true);
    try {
      const va = clipActivity(await getVA(m), m.trim.start, m.trim.end);
      const hints = m.sentences.filter((s) => s.confidence >= 0.5).map((s) => ({ start: s.start, end: s.end, confidence: s.confidence }));
      const segs = smartSegment(va, params, hints);
      const withText = segs.map((s) => {
        const text = m.sentences
          .filter((x) => x.start < s.end && x.end > s.start)
          .map((x) => x.text)
          .join(' ');
        return { ...s, text: text || undefined };
      });
      setSegments(withText);
      sessionStorage.setItem(`segs:${m.id}`, JSON.stringify(withText));
    } finally {
      setComputing(false);
    }
  };

  useEffect(() => {
    const cached = sessionStorage.getItem(`segs:${m.id}`);
    if (cached) {
      try {
        setSegments(JSON.parse(cached));
      } catch {
        /* ignore */
      }
    }
  }, [m.id]);

  /* 稿件对齐 */
  const doAlign = async () => {
    const text = scriptDraft.trim();
    if (!text) return;
    const va = await getVA(m).catch(() => undefined);
    const clipped = va ? clipActivity(va, m.trim.start, m.trim.end) : undefined;
    const sents = alignScript(text, effDur, clipped, m.trim.start);
    const rate = estimateRate(sents.map((s) => s.text).join(' '), effDur);
    const avgLen = sents.length ? sents.reduce((s, x) => s + x.text.length, 0) / sents.length : 0;
    const density: 1 | 2 | 3 = avgLen > 45 ? 3 : avgLen > 22 ? 2 : 1;
    await update({ script: text, sentences: sents, wpm: rate.wpm, density });
  };

  const doCalibrate = async (i: number) => {
    const list = calibrateSentence(m.sentences, i, player.time);
    await update({ sentences: list });
    setCalibIndex(null);
  };

  const lowConf = m.sentences.filter((s) => s.confidence < 0.6).length;

  /* 术语候选 */
  const extract = () => {
    const list = extractCandidates(scriptDraft || m.script || '', terms.map((t) => t.term));
    setCandidates(list);
    setChecked(new Set());
  };
  const addTerms = async () => {
    if (!libId) return;
    for (const c of candidates || []) {
      if (checked.has(c.text)) {
        await saveTerm({
          id: db.uid(),
          libId,
          term: c.text,
          translation: '',
          note: `来自素材「${m.title}」`,
          mastered: false,
          createdAt: Date.now(),
        });
      }
    }
    setChecked(new Set());
  };

  return (
    <>
      <PageHeader
        title={
          <Input
            className="h-8 max-w-md border-transparent bg-transparent px-1 text-lg font-semibold hover:border-input"
            value={m.title}
            onChange={(e) => setM({ ...m, title: e.target.value })}
            onBlur={() => save(m)}
          />
        }
        desc={`时长 ${fmtSec(effDur)} · ${(m.sampleRate / 1000).toFixed(1)} kHz · 创建于 ${new Date(m.createdAt).toLocaleDateString('zh-CN')}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => update({ favorite: !m.favorite })}>
              <Star className={`mr-1 h-3.5 w-3.5 ${m.favorite ? 'fill-current text-amber-500' : ''}`} />
              收藏
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => {
                if (confirm('删除该素材及全部关联训练记录？')) {
                  remove(m.id);
                  nav('/library');
                }
              }}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> 删除
            </Button>
          </>
        }
      />

      <div className="grid gap-4 p-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Section
            title="波形与首尾裁剪"
            desc="拖动滑块裁掉首尾静音，避免训练时无意义等待；裁剪只影响训练区间，不修改原始文件。"
            actions={
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={() => (player.playing ? player.pause() : player.play(player.time))}>
                  {player.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>
                <Select value={String(player.rate)} onValueChange={(v) => player.setRate(Number(v))}>
                  <SelectTrigger className="h-8 w-[72px]">
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
              </div>
            }
          >
            <div className="rounded-md bg-muted/40 p-2">
              <Waveform
                peaks={m.peaks}
                duration={m.duration}
                height={110}
                cursor={player.time + m.trim.start}
                highlight={{ start: m.trim.start, end: m.trim.end }}
                onSeek={(t) => player.seek(Math.max(0, t - m.trim.start))}
                regions={segments?.map((s) => ({
                  start: s.start + m.trim.start,
                  end: s.end + m.trim.start,
                  label: `#${s.index + 1}`,
                }))}
              />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">起点 {m.trim.start.toFixed(1)}s</Label>
                <Slider
                  value={[m.trim.start]}
                  min={0}
                  max={Math.max(1, m.duration)}
                  step={0.1}
                  onValueChange={(v) => setM({ ...m, trim: { ...m.trim, start: Math.min(v[0], m.trim.end - 1) } })}
                  onValueCommit={(v) => update({ trim: { ...m.trim, start: Math.min(v[0], m.trim.end - 1) } })}
                />
              </div>
              <div>
                <Label className="text-xs">终点 {m.trim.end.toFixed(1)}s</Label>
                <Slider
                  value={[m.trim.end]}
                  min={0}
                  max={Math.max(1, m.duration)}
                  step={0.1}
                  onValueChange={(v) => setM({ ...m, trim: { ...m.trim, end: Math.max(v[0], m.trim.start + 1) } })}
                  onValueCommit={(v) => update({ trim: { ...m.trim, end: Math.max(v[0], m.trim.start + 1) } })}
                />
              </div>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              有效训练时长 <b className="text-foreground">{fmtSec(effDur)}</b>（已裁剪 {(m.trim.start + (m.duration - m.trim.end)).toFixed(1)}s）
            </div>
          </Section>

          <Section title="智能分段（交替传译）" desc="设定期望时长后，系统在浮动范围内寻找语义边界切分，而不是按固定秒数硬切。">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label className="text-xs">期望时长（秒）</Label>
                <Input
                  type="number"
                  className="h-8"
                  value={params.target}
                  onChange={(e) => setParams({ ...params, target: Math.max(10, Number(e.target.value)) })}
                />
              </div>
              <div>
                <Label className="text-xs">浮动范围</Label>
                <Select value={String(params.floatPct)} onValueChange={(v) => setParams({ ...params, floatPct: Number(v) })}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.1">±10%</SelectItem>
                    <SelectItem value="0.2">±20%（默认）</SelectItem>
                    <SelectItem value="0.3">±30%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">切分依据偏好</Label>
                <Select value={params.preference} onValueChange={(v) => setParams({ ...params, preference: v as any })}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="balance">平衡（默认）</SelectItem>
                    <SelectItem value="punctuation">优先句末标点</SelectItem>
                    <SelectItem value="pause">优先长停顿</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">最小段长（秒）</Label>
                <Input
                  type="number"
                  className="h-8"
                  value={params.minSeg}
                  onChange={(e) => setParams({ ...params, minSeg: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">最大段长（秒）</Label>
                <Input
                  type="number"
                  className="h-8"
                  value={params.maxSeg}
                  onChange={(e) => setParams({ ...params, maxSeg: Number(e.target.value) })}
                />
              </div>
              <div className="flex items-end">
                <Button size="sm" className="w-full" onClick={runSegment} disabled={computing || !url}>
                  <Waves className="mr-1 h-3.5 w-3.5" />
                  {computing ? '正在分析语音…' : '生成分段'}
                </Button>
              </div>
            </div>

            {segments ? (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    共 {segments.length} 段 · 平均 {(segments.reduce((s, x) => s + (x.end - x.start), 0) / segments.length).toFixed(1)}s ·
                    近似切分 {segments.filter((s) => s.approx).length} 段
                  </span>
                  <span>置信度低或过长的段落建议标记「待调整」</span>
                </div>
                <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                  {segments.map((s) => (
                    <div
                      key={s.index}
                      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                        s.flag ? 'border-amber-400 bg-amber-50' : ''
                      }`}
                    >
                      <span className="w-8 shrink-0 font-medium text-muted-foreground">#{s.index + 1}</span>
                      <span className="w-24 shrink-0 tabular-nums">
                        {fmtSec(s.start)} – {fmtSec(s.end)}
                      </span>
                      <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{(s.end - s.start).toFixed(1)}s</span>
                      <Badge
                        variant={s.confidence > 0.66 ? 'secondary' : s.confidence > 0.4 ? 'outline' : 'destructive'}
                        className="shrink-0 text-[10px]"
                        title="边界置信度：综合停顿长度、句末位置与靠近期望时长的程度"
                      >
                        置信 {Math.round(s.confidence * 100)}%
                        {s.approx ? ' · 近似' : ''}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.text || '（无文本）'}</span>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button size="icon" variant="ghost" className="h-6 w-6" title="试听本段" onClick={() => player.play(s.start, s.end)}>
                          <Play className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          title="起点 -1s"
                          onClick={() => {
                            const next = segments.map((x) =>
                              x.index === s.index ? { ...x, start: Math.max(0, x.start - 1) } : x.index === s.index - 1 ? { ...x, end: Math.max(0, s.start - 1) } : x,
                            );
                            setSegments(next);
                            sessionStorage.setItem(`segs:${m.id}`, JSON.stringify(next));
                          }}
                        >
                          «
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          title="起点 +1s"
                          onClick={() => {
                            const next = segments.map((x) =>
                              x.index === s.index ? { ...x, start: Math.min(x.end - 2, x.start + 1) } : x.index === s.index - 1 ? { ...x, end: Math.min(x.end, s.start + 1) } : x,
                            );
                            setSegments(next);
                            sessionStorage.setItem(`segs:${m.id}`, JSON.stringify(next));
                          }}
                        >
                          »
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          title="与下一段合并"
                          onClick={() => {
                            const next = mergeAt(segments, s.index);
                            setSegments(next);
                            sessionStorage.setItem(`segs:${m.id}`, JSON.stringify(next));
                          }}
                        >
                          <Merge className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          title="从播放头处拆分"
                          onClick={() => {
                            const next = splitSegment(segments, s.index, player.time);
                            setSegments(next);
                            sessionStorage.setItem(`segs:${m.id}`, JSON.stringify(next));
                          }}
                        >
                          <Scissors className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className={`h-6 w-6 ${s.flag ? 'text-amber-500' : ''}`}
                          title="标记待调整"
                          onClick={() => {
                            const next = segments.map((x) => (x.index === s.index ? { ...x, flag: !x.flag } : x));
                            setSegments(next);
                            sessionStorage.setItem(`segs:${m.id}`, JSON.stringify(next));
                          }}
                        >
                          <Flag className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      sessionStorage.setItem(`segs:${m.id}`, JSON.stringify(segments));
                      nav(`/train/consecutive/${m.id}`);
                    }}
                  >
                    从头开始交传训练
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const start = segments.findIndex((s) => s.flag);
                      sessionStorage.setItem(`segs:${m.id}`, JSON.stringify(segments));
                      sessionStorage.setItem(`startSeg:${m.id}`, String(start >= 0 ? start : 0));
                      nav(`/train/consecutive/${m.id}`);
                    }}
                  >
                    从第 N 段续练
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                设置参数后点击「生成分段」，系统会基于语音停顿
                {m.sentences.length ? '与已对齐稿件句边界' : ''}给出分段建议
              </div>
            )}
          </Section>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Section title="素材信息" desc="标签与难度标注用于选材参考。">
            <div className="space-y-3">
              <div>
                <Label className="text-xs">主题标签</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="gap-1">
                      {t}
                      <button
                        className="ml-0.5 text-muted-foreground hover:text-foreground"
                        onClick={() => update({ tags: m.tags.filter((x) => x !== t) })}
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                  <Input
                    className="h-6 w-24 text-xs"
                    placeholder="回车添加"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && tagInput.trim()) {
                        update({ tags: [...new Set([...m.tags, tagInput.trim()])] });
                        setTagInput('');
                      }
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">难度</Label>
                  <Select value={m.difficulty} onValueChange={(v) => update({ difficulty: v as any })}>
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="easy">入门</SelectItem>
                      <SelectItem value="medium">进阶</SelectItem>
                      <SelectItem value="hard">高难</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">口音</Label>
                  <Input className="h-8" value={m.accent} placeholder="如 美音/英音/印度英语" onChange={(e) => setM({ ...m, accent: e.target.value })} onBlur={() => save(m)} />
                </div>
                <div>
                  <Label className="text-xs">语速标签</Label>
                  <Select value={m.speechRate || 'none'} onValueChange={(v) => update({ speechRate: v === 'none' ? '' : v })}>
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">未标注</SelectItem>
                      <SelectItem value="慢">慢</SelectItem>
                      <SelectItem value="中速">中速</SelectItem>
                      <SelectItem value="快">快</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">计划重练日期</Label>
                  <Input
                    className="h-8"
                    type="date"
                    value={m.replayAt ? new Date(m.replayAt).toISOString().slice(0, 10) : ''}
                    onChange={(e) => update({ replayAt: e.target.value ? new Date(e.target.value).getTime() : undefined })}
                  />
                </div>
              </div>
              <div className="rounded-md bg-muted/50 p-2 text-xs">
                <div className="flex items-center gap-1 font-medium">
                  <Gauge className="h-3.5 w-3.5" /> 难度估算（A-04）
                </div>
                <div className="mt-1 text-muted-foreground">
                  {m.wpm ? `估算语速 ${m.wpm} wpm` : '语速：需导入稿件后估算'}
                  {m.density ? ` · 信息密度等级 ${m.density}/3` : ''}
                  {m.wpm ? '' : ' · 也可手动选择难度标签'}
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="文本稿件 / 字幕"
            desc="带稿同传需要；含时间码的 SRT/VTT 可直接高置信对齐，纯文本按语音分布粗对齐后可手动校准。"
            actions={
              <>
                <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
                  <Upload className="mr-1 h-3.5 w-3.5" /> 导入文件
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.srt,.vtt,.md"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const t = await f.text();
                    setScriptDraft(t);
                  }}
                />
              </>
            }
          >
            <Textarea
              className="min-h-[120px] text-xs"
              placeholder="粘贴讲话稿或字幕内容…（含 00:00:01,000 --> 00:00:04,000 时间码时自动按时间码对齐）"
              value={scriptDraft}
              onChange={(e) => setScriptDraft(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={doAlign} disabled={!scriptDraft.trim()}>
                <Sparkles className="mr-1 h-3.5 w-3.5" /> 对齐到音频
              </Button>
              {hasTimecodes(scriptDraft) ? (
                <Badge variant="secondary" className="text-[10px]">
                  检测到时间码 · 高置信对齐
                </Badge>
              ) : scriptDraft.trim() ? (
                <Badge variant="outline" className="text-[10px]">
                  纯文本 · 粗对齐，建议校准
                </Badge>
              ) : null}
              {m.sentences.length ? (
                <span className="text-xs text-muted-foreground">
                  已对齐 {m.sentences.length} 句{lowConf ? ` · ${lowConf} 句低置信` : ''}
                </span>
              ) : null}
            </div>

            {m.sentences.length ? (
              <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
                {m.sentences.map((s) => (
                  <div
                    key={s.id}
                    className={`flex items-start gap-2 rounded-md border px-2 py-1 text-xs ${
                      calibIndex === s.index ? 'border-primary bg-primary/5' : ''
                    }`}
                  >
                    <button
                      className="w-20 shrink-0 text-left tabular-nums text-muted-foreground hover:text-foreground"
                      onClick={() => player.play(s.start, Math.min(s.end, effDur))}
                      title="点击试听该句"
                    >
                      {fmtSec(s.start)}–{fmtSec(s.end)}
                    </button>
                    <span className="min-w-0 flex-1">{s.text}</span>
                    <Badge
                      variant={s.confidence > 0.7 ? 'secondary' : 'outline'}
                      className={`shrink-0 text-[10px] ${s.confidence < 0.6 ? 'text-amber-600' : ''}`}
                    >
                      {Math.round(s.confidence * 100)}%
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      title="以当前播放位置校准该句起点"
                      onClick={() => doCalibrate(s.index)}
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </Section>

          <Section title="术语候选提取" desc="从稿件中提取数字、专有名词等候选术语，勾选后加入术语库。">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={extract} disabled={!scriptDraft.trim() && !m.script}>
                <Sparkles className="mr-1 h-3.5 w-3.5" /> 提取候选
              </Button>
              {candidates?.length ? (
                <>
                  <Select value={libId} onValueChange={setLibId}>
                    <SelectTrigger className="h-8 w-40">
                      <SelectValue placeholder="选择术语库" />
                    </SelectTrigger>
                    <SelectContent>
                      {libs.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={addTerms} disabled={!libId || !checked.size}>
                    <BookMarked className="mr-1 h-3.5 w-3.5" /> 加入术语库（{checked.size}）
                  </Button>
                </>
              ) : null}
            </div>
            {candidates?.length ? (
              <div className="mt-2 max-h-52 space-y-1 overflow-y-auto pr-1">
                {candidates.slice(0, 60).map((c) => (
                  <label key={c.text} className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent">
                    <Checkbox
                      checked={checked.has(c.text)}
                      onCheckedChange={(v) => {
                        const next = new Set(checked);
                        v ? next.add(c.text) : next.delete(c.text);
                        setChecked(next);
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate">{c.text}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {c.kind === 'number' ? '数字' : c.kind === 'proper' ? '专名' : c.kind === 'glossary' ? '已收录' : '短语'}
                    </Badge>
                    <span className="w-8 text-right text-muted-foreground">×{c.count}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">导入或粘贴稿件后可提取候选术语。</p>
            )}
          </Section>

          <Section title="开始训练">
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" onClick={() => nav(`/train/consecutive/${m.id}`)}>
                交替传译
              </Button>
              <Button size="sm" variant="outline" onClick={() => nav(`/train/sim-text/${m.id}`)}>
                带稿同传
              </Button>
              <Button size="sm" variant="outline" onClick={() => nav(`/train/sim-noscript/${m.id}`)}>
                无稿同传
              </Button>
              <Button size="sm" variant="outline" onClick={() => nav(`/train/shadowing/${m.id}`)}>
                影子练习
              </Button>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
