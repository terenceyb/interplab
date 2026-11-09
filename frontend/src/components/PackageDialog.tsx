import { browserDownload, saveBlob } from '@/lib/desktop';
import { useRef, useState } from 'react';
import { FolderOpen, Package, Upload, DownloadCloud, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useApp } from '@/store/useApp';
import { exportPackage, importFolder, importPackage, type ImportResult } from '@/lib/package';
import { cn } from '@/lib/utils';

type Tab = 'import' | 'folder' | 'export';

/**
 * 数据包 / 文件夹导入导出。
 * 数据包 = 素材 + 稿件 + 训练记录 + 术语库，一个文件搬家；
 * 文件夹 = 本地放好「同名音频 + 稿件」，一次导入自动配对并解析。
 */
export function PackageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { materials, sessions, libs, terms, vocab, plan, profile, init } = useApp();
  const [tab, setTab] = useState<Tab>('import');
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [withAudio, setWithAudio] = useState(true);
  const pkgRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    await init();
  };

  const describe = (r: ImportResult & { orphanDocs?: string[] }) => {
    const parts = [`素材 ${r.materials}`, `记录 ${r.sessions}`];
    if (r.terms) parts.push(`术语 ${r.terms}`);
    if (r.skipped) parts.push(`跳过 ${r.skipped}`);
    let text = `导入完成：${parts.join(' · ')}`;
    if (r.warnings?.length) text += `\n${r.warnings.slice(0, 4).join('\n')}`;
    if (r.orphanDocs?.length) text += `\n未配对的稿件：${r.orphanDocs.slice(0, 5).join('、')}`;
    return text;
  };

  const doImportPackage = async (file: File) => {
    setBusy(true);
    setPct(0);
    setMsg(null);
    try {
      const r = await importPackage(file, (p, m) => {
        setPct(p);
        if (m) setMsg({ ok: true, text: m });
      });
      await refresh();
      setMsg({ ok: true, text: describe(r) });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setPct(100);
    }
  };

  const doImportFolder = async (files: File[]) => {
    setBusy(true);
    setPct(0);
    setMsg(null);
    try {
      const r = await importFolder(files, (p, m) => {
        setPct(p);
        if (m) setMsg({ ok: true, text: m });
      });
      await refresh();
      setMsg({ ok: true, text: describe(r) });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setPct(100);
    }
  };

  const doExport = async () => {
    setBusy(true);
    setPct(0);
    setMsg(null);
    try {
      const blob = await exportPackage(
        { materials, sessions, libs, terms, vocab, plan, profile },
        { includeAudio: withAudio },
        (p, m) => {
          setPct(p);
          if (m) setMsg({ ok: true, text: m });
        },
      );
      const name = `interplab-数据包-${new Date().toISOString().slice(0, 10)}.ipkg`;
      const size = `${(blob.size / 1024 / 1024).toFixed(1)} MB`;
      const outcome = await saveBlob(name, blob);
      if (outcome === 'unsupported') browserDownload(name, blob);
      if (outcome === 'canceled') {
        setMsg({ ok: false, text: '已取消保存，数据包没有写出' });
        return;
      }
      setMsg({
        ok: true,
        text: `已导出 ${name}（${size}）· 素材 ${materials.length} · 记录 ${sessions.length}`,
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const tabs: { key: Tab; label: string; icon: LucideIcon }[] = [
    { key: 'import', label: '导入数据包', icon: Package },
    { key: 'folder', label: '导入文件夹', icon: FolderOpen },
    { key: 'export', label: '导出数据包', icon: DownloadCloud },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>数据包搬家</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                setMsg(null);
              }}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors',
                tab === t.key ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {tab === 'import' ? (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>选择 `.ipkg` / `.zip` 数据包，含训练素材、稿件、训练记录与术语库。</p>
              <Button size="sm" disabled={busy} onClick={() => pkgRef.current?.click()}>
                <Upload className="mr-1 h-3.5 w-3.5" /> 选择数据包文件
              </Button>
              <input
                ref={pkgRef}
                type="file"
                accept=".ipkg,.zip,application/zip"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void doImportPackage(f);
                }}
              />
            </div>
          ) : null}

          {tab === 'folder' ? (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>把音频/视频和稿件放在同一个文件夹里，文件名相同即可自动配对：</p>
              <pre className="rounded bg-muted p-2 text-[11px] leading-relaxed text-foreground">{`我的素材/
  拜登演讲.mp3      +  拜登演讲.docx   → 一条素材（音频 + 文字稿）
  峰会开幕.mp4      +  峰会开幕.pptx   → 一条素材（视频 + 幻灯片）
  记者会.mp3                              → 一条素材（仅音频）`}</pre>
              <Button size="sm" disabled={busy} onClick={() => folderRef.current?.click()}>
                <FolderOpen className="mr-1 h-3.5 w-3.5" /> 选择文件夹
              </Button>
              <input
                ref={folderRef}
                type="file"
                className="hidden"
                // @ts-expect-error 非标准属性，但主流浏览器都支持
                webkitdirectory=""
                directory=""
                multiple
                onChange={(e) => {
                  const files = e.target.files ? [...e.target.files] : [];
                  e.target.value = '';
                  if (files.length) void doImportFolder(files);
                }}
              />
            </div>
          ) : null}

          {tab === 'export' ? (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                导出当前全部素材（{materials.length}）、训练记录（{sessions.length}）、术语库，用于换设备或长期备份。
              </p>
              <label className="flex items-center gap-2 text-foreground">
                <input
                  type="checkbox"
                  checked={withAudio}
                  onChange={(e) => setWithAudio(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                包含音视频与录音文件（体积大，但可直接在新设备恢复训练）
              </label>
              <Button size="sm" disabled={busy} onClick={doExport}>
                <DownloadCloud className="mr-1 h-3.5 w-3.5" /> 生成数据包
              </Button>
            </div>
          ) : null}

          {busy || pct > 0 ? <Progress value={pct} className="h-1.5" /> : null}
          {msg ? (
            <div
              className={cn(
                'whitespace-pre-wrap rounded-md border p-2 text-[11px]',
                msg.ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10',
              )}
            >
              {msg.text}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
