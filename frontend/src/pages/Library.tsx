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

const DIFF_LABEL: Record<string, string> = { easy: '入门', medium: '进阶', hard: '高难' };

export default function Library() {
  const { materials, saveMaterial, removeMaterial, sessions } = useApp();
  const [q, setQ] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return materials.filter((m) => {
      if (favOnly && !m.favorite) return false;
      if (!kw) return true;
      return (
        m.title.toLowerCase().includes(kw) ||
        m.tags.some((t) => t.toLowerCase().includes(kw)) ||
        m.accent.toLowerCase().includes(kw)
      );
    });
  }, [materials, q, favOnly]);

  async function handleFiles(files: FileList | File[]) {
    const arr = [...files].filter((f) => /audio|\/mp3|\/wav|\/m4a|\/mpeg|\/mp4|octet-stream/i.test(f.type) || /\.(mp3|wav|m4a|aac|ogg|flac|mp4|webm)$/i.test(f.name));
    if (!arr.length) return;
    setUploading(true);
    setProgress(0);
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      setStatus(`正在解码 ${f.name}…`);
      setProgress(Math.round((i / arr.length) * 100));
      try {
        const decoded = await decodeFile(f);
        const edges = detectSilenceEdges(decoded.buffer);
        const peaks = computePeaks(decoded.buffer);
        const key = await db.putAudio(f);
        const m: Material = {
          id: db.uid(),
          title: f.name.replace(/\.[^.]+$/, ''),
          createdAt: Date.now(),
          audioKey: key,
          duration: decoded.duration,
          sampleRate: decoded.sampleRate,
          peaks,
          trim: { start: edges.start, end: edges.end },
          tags: [],
          difficulty: 'medium',
          accent: '',
          speechRate: '',
          favorite: false,
          sentences: [],
        };
        await db.putMaterial(m);
      } catch (e) {
        console.error(e);
        setStatus(`${f.name} 解码失败，请确认是有效的音频文件`);
      }
    }
    setProgress(100);
    setStatus('完成');
    await useApp.getState().refreshMaterials();
    setTimeout(() => {
      setUploading(false);
      setStatus('');
    }, 600);
  }

  return (
    <>
      <PageHeader
        title="个人素材库"
        desc="上传训练用源语音频。所有素材默认仅本人可见，保存在本机浏览器，不上传云端。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setFavOnly((v) => !v)}>
              <Star className={`mr-1 h-3.5 w-3.5 ${favOnly ? 'fill-current text-amber-500' : ''}`} /> 收藏
            </Button>
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-3.5 w-3.5" /> 上传音频
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.mp4,.ogg,.flac,.webm"
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
        <p className="mt-2 text-sm text-muted-foreground">把音频拖到这里，或点击右上角「上传音频」</p>
        <p className="mt-1 text-xs text-muted-foreground">支持 MP3 / WAV / M4A 等常见格式，建议单文件 60 分钟以内</p>
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

      <div className="grid gap-3 p-6 md:grid-cols-2 xl:grid-cols-3">
        {list.map((m) => {
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
        {!list.length ? (
          <div className="col-span-full">
            <Empty icon={<AudioLines className="h-6 w-6 text-muted-foreground" />} text="还没有素材，先上传一段音频开始练习" />
          </div>
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
