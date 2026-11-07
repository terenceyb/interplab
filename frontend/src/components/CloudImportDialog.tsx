import { useRef, useState } from 'react';
import {
  CloudDownload,
  FolderOpen,
  Link2,
  ShieldAlert,
  Loader2,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onFiles: (files: File[], sourceLabel?: string) => void | Promise<void>;
}

/**
 * 网盘 / 外部素材导入。
 *
 * 说明（重要）：本平台是纯前端静态站点，没有后端。百度网盘、阿里云盘的「账号挂载」
 * 需要 OAuth 授权码换 token，而换 token 必须携带 app_secret —— 一旦放进浏览器端代码
 * 就等于公开泄露，且两个平台的文件下载接口都不返回允许跨域的响应头。
 * 因此「保存到网盘后自动拉取」必须有一个后端代理，本页给出可用的替代路径。
 */
export function CloudImportDialog({ open, onOpenChange, onFiles }: Props) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  const nameFromUrl = (u: string) => {
    try {
      const p = new URL(u).pathname.split('/').filter(Boolean).pop() || 'import';
      return decodeURIComponent(p).replace(/[?#].*$/, '') || 'import';
    } catch {
      return 'import';
    }
  };

  async function importByUrl() {
    const raw = url.trim();
    if (!raw) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(raw, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const name = nameFromUrl(raw);
      const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
      await onFiles([file], '直链');
      setMsg({ ok: true, text: `已导入 ${name}` });
      setUrl('');
    } catch (e: any) {
      const text = String(e?.message || e);
      setMsg({
        ok: false,
        text: /Failed to fetch|NetworkError|Load failed/i.test(text)
          ? '下载被目标站点的跨域策略（CORS）阻止。请先把文件下载到本地，再用「本地文件夹」或直接拖入素材库。'
          : `导入失败：${text}`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudDownload className="h-4 w-4" /> 从网盘 / 外部导入素材
          </DialogTitle>
          <DialogDescription>
            支持直链下载与本地文件夹批量导入；百度网盘、阿里云盘的账号挂载受平台接口限制，见下方说明。
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="url">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="url">
              <Link2 className="mr-1.5 h-3.5 w-3.5" /> 直链导入
            </TabsTrigger>
            <TabsTrigger value="pan">百度 / 阿里云盘</TabsTrigger>
            <TabsTrigger value="folder">
              <FolderOpen className="mr-1.5 h-3.5 w-3.5" /> 本地文件夹
            </TabsTrigger>
          </TabsList>

          <TabsContent value="url" className="space-y-3 pt-3">
            <Label className="text-xs text-muted-foreground">
              粘贴以 http(s) 开头、可直接下载的音频 / 视频地址（如对象存储直链、自建网盘直链）
            </Label>
            <div className="flex gap-2">
              <Input
                placeholder="https://example.com/audio.mp3"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && importByUrl()}
              />
              <Button onClick={importByUrl} disabled={busy || !url.trim()}>
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="mr-1.5 h-3.5 w-3.5" />}
                下载导入
              </Button>
            </div>
            {msg && (
              <div
                className={`flex items-start gap-2 rounded-md border p-2.5 text-xs ${
                  msg.ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'
                }`}
              >
                {msg.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                ) : (
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                )}
                <span>{msg.text}</span>
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              浏览器会直接向你填写的地址发起请求；对方站点若未开放跨域（CORS），下载会被拦截，这属于浏览器安全策略，无法绕过。
            </p>
          </TabsContent>

          <TabsContent value="pan" className="space-y-3 pt-3">
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div>
                <b>账号挂载当前不可用，原因不是没做，而是架构限制。</b>
                <br />
                百度网盘 / 阿里云盘的开放接口都需要「OAuth 授权码 → 换取 access_token」，换 token 必须携带
                <code className="mx-1 rounded bg-muted px-1">app_secret</code>
                并做服务端签名。本平台是纯前端站点（数据都存在你本机浏览器，没有服务器），
                把 secret 写进前端代码等于公开泄露；且两家文件下载接口都不返回允许跨域的响应头。
                结论：<b>要真正挂载账号，必须先部署一个后端代理服务</b>。
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-3 text-xs">
              <div className="font-medium">现在就能用的替代路径（二选一）</div>
              <ol className="ml-4 list-decimal space-y-1 text-muted-foreground">
                <li>
                  在网盘里把文件「下载到本地」→ 用左侧「本地文件夹」或直接拖进素材库（推荐，最稳）
                </li>
                <li>
                  如果文件能生成<strong>直链</strong>（部分网盘会员支持），用「直链导入」粘贴地址
                </li>
              </ol>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => window.open('https://pan.baidu.com', '_blank')}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> 打开百度网盘
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.open('https://www.alipan.com', '_blank')}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> 打开阿里云盘
              </Button>
            </div>

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              若你有服务器，我可以补一个仅做「OAuth 换 token + 文件流转发」的最小代理（约 100 行），
              届时这里会变成真正的账号挂载入口。需要的话告诉我部署环境。
            </p>
          </TabsContent>

          <TabsContent value="folder" className="space-y-3 pt-3">
            <Label className="text-xs text-muted-foreground">
              选择一个文件夹，批量导入其中的音频 / 视频（含子目录），文件名会作为素材标题
            </Label>
            <input
              ref={dirRef}
              type="file"
              multiple
              // @ts-expect-error 非标准属性，Chrome/Edge/Safari 支持
              webkitdirectory="true"
              directory=""
              className="hidden"
              onChange={(e) => {
                const files = e.target.files ? [...e.target.files] : [];
                const media = files.filter(
                  (f) => /^(audio|video)\//.test(f.type) || /\.(mp3|wav|m4a|aac|ogg|flac|mp4|mov|m4v|webm|mkv)$/i.test(f.name),
                );
                if (media.length) {
                  void onFiles(media, '文件夹');
                  onOpenChange(false);
                }
                e.target.value = '';
              }}
            />
            <Button variant="outline" onClick={() => dirRef.current?.click()}>
              <FolderOpen className="mr-1.5 h-3.5 w-3.5" /> 选择文件夹
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
