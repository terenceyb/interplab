import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AudioLines, Star, Trash2, Upload, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader, Empty, Stat } from '@/components/PageHeader';
import { useApp } from '@/store/useApp';
import * as db from '@/lib/db';
import { decodeFile, detectSilenceEdges, computePeaks } from '@/lib/audio';
import { estimateRate } from '@/lib/vad';
import type { Material } from '@/types';
import { fmtSec } from '@/lib/metrics';
import { CloudDownload } from 'lucide-react';
import { CloudImportDialog } from '@/components/CloudImportDialog';
import { LANGUAGES, langLabel, langShort } from '@/lib/languages';
import type { MaterialLanguage } from '@/types';

const DIFF_LABEL: Record<string, string> = { easy: '入门', medium: '进阶', hard: '高难' };

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const isVideoFile = (f: File) => f.type.startsWith('video/') || VIDEO_EXT.test(f.name);

/** 读取视频时长（音轨不可解码时的兜底） */
function probeVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.src = url;
    const done = (d: number) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : 0);
    v.onerror = () => done(0);
    setTimeout(() => done(Number.isFinite(v.duration) ? v.duration : 0), 8000);
  });
}

export default function Library() {
  const { materials, saveMaterial, removeMaterial, sessions } = useApp();
  const [q, setQ] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [drag, setDrag] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [langFilter, setLangFilter] = useState<'all' | MaterialLanguage | 'none'>('all');
  const fileRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return materials.filter((m) => {
      if (favOnly && !m.favorite) return false;
      if (langFilter !== 'all') {
        const key = m.language ?? 'none';
        if (key !== langFilter) return false;
      }
      if (!kw) return true;
      return (
        m.title.toLowerCase().includes(kw) ||
        m.tags.some((t) => t.toLowerCase().includes(kw)) ||
        m.accent.toLowerCase().includes(kw)
      );
    });
  }, [materials, q, favOnly, langFilter]);

  /** 按源语语言分组：按预设语言顺序，未标注排最后 */
  const grouped = useMemo(() => {
    const map = new Map<string, typeof list>();
    for (const m of list) {
      const k = m.language ?? 'none';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    const order: string[] = [...LANGUAGES.map((l) => l.code), 'none'];
    return order.filter((k) => map.has(k)).map((k) => ({ key: k, items: map.get(k)! }));
  }, [list]);

  /** 各语言素材数量，用于筛选条 */
  const langCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of materials) {
      const k = m.language ?? 'none';
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [materials]);

  async function handleFiles(files: FileList | File[]) {
    const arr = [...files].filter(
      (f) =>
        /^(audio|video)\//.test(f.type) ||
        /\.(mp3|wav|m4a|aac|ogg|flac|mp4|mov|m4v|webm|mkv)$/i.test(f.name),
    );
    if (!arr.length) return;
    await ingest(arr);
  }

  /** 统一导入：音频解码波形，视频额外挂 video 元素承载画面 */
  async function ingest(arr: File[], sourceLabel?: string) {
    setUploading(true);
    setProgress(0);
    let ok = 0;
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      const video = isVideoFile(f);
      setStatus(`正在处理 ${f.name}…`);
      setProgress(Math.round((i / arr.length) * 100));
      try {
        const key = await db.putAudio(f);
        let duration = 0;
        let sampleRate = 48000;
        let peaks: number[] = [];
        let trim = { start: 0, end: 0 };
        let noWaveform = false;
        try {
          const decoded = await decodeFile(f);
          const edges = detectSilenceEdges(decoded.buffer);
          duration = decoded.duration;
          sampleRate = decoded.sampleRate;
          peaks = computePeaks(decoded.buffer);
          trim = { start: edges.start, end: edges.end };
        } catch {
          if (!video) throw new Error('decode-failed');
          // 视频音轨无法解码：用视频时长兜底，波形留空（分段退化为等时长）
          duration = await probeVideoDuration(f);
          noWaveform = true;
          trim = { start: 0, end: duration };
          if (!duration) throw new Error('no-duration');
        }
        const m: Material = {
          id: db.uid(),
          title: f.name.replace(/\.[^.]+$/, ''),
          createdAt: Date.now(),
          audioKey: key,
          kind: video ? 'video' : 'audio',
          noWaveform,
          duration,
          sampleRate,
          peaks,
          trim,
          tags: [],
          difficulty: 'medium',
          accent: '',
          speechRate: '',
          favorite: false,
          sentences: [],
        };
        await db.putMaterial(m);
        ok += 1;
      } catch (e) {
        console.error(e);
        setStatus(
          isVideoFile(f)
            ? `${f.name} 无法解析，建议转成 MP4(H.264/AAC) 或 WebM 后重试`
            : `${f.name} 解码失败，请确认是有效的音频文件`,
        );
      }
    }
    setProgress(100);
    setStatus(ok ? `已导入 ${ok} 个${sourceLabel ? `（${sourceLabel}）` : ''}` : '未导入任何文件');
    await useApp.getState().refreshMaterials();
    setTimeout(() => {
      setUploading(false);
      setStatus('');
    }, 900);
  }

  return (
    <>
      <CloudImportDialog
        open={cloudOpen}
        onOpenChange={setCloudOpen}
        onFiles={(files, label) => ingest(files, label)}
      />
      <PageHeader
        title="个人素材库"
        desc="上传训练用源语音频。所有素材默认仅本人可见，保存在本机浏览器，不上传云端。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setFavOnly((v) => !v)}>
              <Star className={`mr-1 h-3.5 w-3.5 ${favOnly ? 'fill-current text-amber-500' : ''}`} /> 收藏
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCloudOpen(true)}>
              <CloudDownload className="mr-1 h-3.5 w-3.5" /> 外部导入
            </Button>
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-3.5 w-3.5" /> 上传音频 / 视频
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.flac,.mp4,.mov,.m4v,.webm,.mkv"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
          </>
        }
      />

      <div
        className={`mx-6 mt-4 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          drag ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
        }}
      >
        <AudioLines className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">把音频或视频拖到这里，或点击右上角「上传音频 / 视频」</p>
        <p className="mt-1 text-xs text-muted-foreground">音频 MP3 / WAV / M4A，视频 MP4 / MOV / WebM；建议单文件 60 分钟以内</p>
      </div>

      <div className="mx-6 mt-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="搜索素材名称、主题标签、口音…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="text-xs text-muted-foreground">共 {materials.length} 个素材</div>
      </div>

      {/* 源语语言筛选 */}
      <div className="mx-6 mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted-foreground">源语</span>
        <button
          onClick={() => setLangFilter('all')}
          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
            langFilter === 'all' ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
          }`}
        >
          全部 {materials.length}
        </button>
        {LANGUAGES.filter((l) => langCounts[l.code]).map((l) => (
          <button
            key={l.code}
            onClick={() => setLangFilter(l.code)}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              langFilter === l.code ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
            }`}
          >
            {l.label} {langCounts[l.code]}
          </button>
        ))}
        {langCounts.none ? (
          <button
            onClick={() => setLangFilter('none')}
            className={`rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground transition-colors ${
              langFilter === 'none' ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
            }`}
          >
            未标注 {langCounts.none}
          </button>
        ) : null}
      </div>

      <div className="space-y-6 p-6">
        {grouped.map((g) => (
          <section key={g.key}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-semibold">
                {g.key === 'none' ? '未标注语言' : langLabel(g.key)}
              </h2>
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                {g.items.length}
              </Badge>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {g.items.map((m) => {
          const rounds = sessions.filter((s) => s.materialId === m.id).length;
          return (
            <Card key={m.id} className="group p-4">
              <div className="flex items-start justify-between gap-2">
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => nav(`/material/${m.id}`)}
                >
                  <div className="truncate text-sm font-medium hover:underline">{m.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{fmtSec(Math.max(0, m.trim.end - m.trim.start))}</span>
                    <span>·</span>
                    <Badge
                      variant={m.language ? 'secondary' : 'outline'}
                      className={`px-1 py-0 text-[10px] ${m.language ? '' : 'text-muted-foreground'}`}
                    >
                      {m.language ? langShort(m.language) : '未标注'}
                    </Badge>
                    <span>·</span>
                    {m.kind === 'video' ? (
                      <>
                        <Badge variant="outline" className="px-1 py-0 text-[10px]">
                          视频
                        </Badge>
                        <span>·</span>
                      </>
                    ) : null}
                    <span>{DIFF_LABEL[m.difficulty]}</span>
                    {m.wpm ? (
                      <>
                        <span>·</span>
                        <span>{m.wpm} wpm</span>
                      </>
                    ) : null}
                    {rounds ? (
                      <>
                        <span>·</span>
                        <span>已练 {rounds} 轮</span>
                      </>
                    ) : null}
                  </div>
                </button>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => saveMaterial({ ...m, favorite: !m.favorite })}
                  >
                    <Star className={`h-3.5 w-3.5 ${m.favorite ? 'fill-current text-amber-500' : ''}`} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => {
                      if (confirm(`删除素材「${m.title}」及其全部训练记录？该操作不可恢复。`)) removeMaterial(m.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex h-10 items-end gap-[1px]">
                {m.peaks
                  .filter((_, i) => i % Math.max(1, Math.floor(m.peaks.length / 80)) === 0)
                  .slice(0, 80)
                  .map((p, i) => (
                    <div key={i} className="flex-1 rounded-sm bg-primary/40" style={{ height: `${Math.max(2, p * 100)}%` }} />
                  ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {m.tags.map((t) => (
                  <Badge key={t} variant="secondary" className="text-[11px]">
                    {t}
                  </Badge>
                ))}
                {m.accent ? <Badge variant="outline" className="text-[11px]">{m.accent}</Badge> : null}
                {m.speechRate ? <Badge variant="outline" className="text-[11px]">{m.speechRate}</Badge> : null}
                {m.sentences.length ? <Badge variant="outline" className="text-[11px]">已对齐 {m.sentences.length} 句</Badge> : null}
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => nav(`/train/consecutive/${m.id}`)}>
                  交传
                </Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => nav(`/train/sim-text/${m.id}`)}>
                  带稿同传
                </Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => nav(`/train/sim-noscript/${m.id}`)}>
                  无稿同传
                </Button>
              </div>
            </Card>
          );
        })}
            </div>
          </section>
        ))}
        {!list.length ? (
          <Empty
            icon={<AudioLines className="h-6 w-6 text-muted-foreground" />}
            text={langFilter === 'all' ? '还没有素材，先上传一段音频开始练习' : '该语言下暂无素材'}
          />
        ) : null}
      </div>

      <div className="mx-6 mb-8 grid gap-3 md:grid-cols-3">
        <Stat label="素材总数" value={materials.length} />
        <Stat label="累计训练轮次" value={sessions.length} />
        <Stat
          label="累计训练时长"
          value={fmtSec(sessions.reduce((s, x) => s + x.duration, 0))}
          hint="按源语有效训练时长统计"
        />
      </div>

      <Dialog open={uploading} onOpenChange={(v) => !v && setUploading(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>正在处理音频</DialogTitle>
          </DialogHeader>
          <Progress value={progress} className="mt-2" />
          <p className="mt-2 text-xs text-muted-foreground">{status || '准备中…'}</p>
          <p className="text-xs text-muted-foreground">
            本地解码音频并生成波形预览，同时自动检测首尾静音——这一步完全在本机完成。
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

export { estimateRate, DIFF_LABEL };
