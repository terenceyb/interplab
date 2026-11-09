import { useEffect, useState } from 'react';
import { AlertTriangle, Database, Keyboard, Package, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader, Section } from '@/components/PageHeader';
import { useApp } from '@/store/useApp';
import * as db from '@/lib/db';
import { PackageDialog } from '@/components/PackageDialog';
import { fmtBytes, readResources, runCleanup, type ResourceSnapshot } from '@/lib/perf';

const HOTKEYS: [string, string][] = [
  ['Space', '训练页：开始 / 暂停；复盘页：播放 / 暂停'],
  ['← / →', '幻灯片翻页；复盘页前后跳 5 秒'],
  ['Tab', '带稿同传：在「稿件」与「幻灯片」之间切换'],
  ['H', '隐藏 / 显示稿件（纯听状态）'],
  ['R', '交传：重播当前分段'],
  ['Enter / Esc', '交传：开始录制 / 完成本段'],
  ['M', '复盘：添加时间锚点标记'],
  ['1 / 2 / 3 / 4', '复盘：快速选择问题类型（漏译 / 误译 / 长停顿 / EVS 过短）'],
  ['S', '复盘：切换 源语 / 译语 / 混合 / 双耳分听'],
  ['B / N', '无稿同传：标记跟得太紧 / 太松'],
];

export default function Settings() {
  const { profile, setProfile, sessions, materials, wipe } = useApp();
  const [name, setName] = useState(profile.name);
  const [usage, setUsage] = useState({ bytes: 0, count: 0 });
  const [pkgOpen, setPkgOpen] = useState(false);
  const [res, setRes] = useState<ResourceSnapshot | null>(null);
  const [cleanMsg, setCleanMsg] = useState('');

  useEffect(() => {
    db.estimateUsage().then(setUsage);
    readResources().then(setRes);
  }, [sessions, materials]);

  return (
    <>
      <PageHeader title="数据与设置" desc="单用户产品：所有素材、录音、复盘记录默认仅本人可见，无公开分享与社交入口。" />

      <PackageDialog open={pkgOpen} onOpenChange={setPkgOpen} />

      <div className="grid gap-4 p-6 lg:grid-cols-2">
        <Section title="个人档案" desc="仅用于本机显示，不涉及账号体系与云端同步。">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-xs">称呼</Label>
              <Input className="mt-1 h-8" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button size="sm" onClick={() => setProfile({ ...profile, name: name.trim() || '我' })}>
              <UserRound className="mr-1 h-3.5 w-3.5" /> 保存
            </Button>
          </div>
        </Section>

        <Section title="存储用量" desc="素材与录音保存在本机浏览器数据库（IndexedDB）。">
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">音频文件数</span>
              <span className="tabular-nums">{usage.count}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">占用空间（约）</span>
              <span className="tabular-nums">{(usage.bytes / 1024 / 1024).toFixed(1)} MB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">素材 / 训练记录</span>
              <span className="tabular-nums">
                {materials.length} / {sessions.length}
              </span>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            浏览器可能在空间紧张时清理站点数据，重要录音建议定期导出备份。
          </p>
        </Section>

        <Section
          title="数据包搬家"
          desc="素材 + 稿件 + 训练记录打包成一个文件；也可以直接选一个本地文件夹，同名文件自动配对。"
        >
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setPkgOpen(true)}>
              <Package className="mr-1 h-3.5 w-3.5" /> 打开数据包工具
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            换设备、清缓存前建议先导出；导入不会覆盖已有数据，只会追加。
          </p>
        </Section>

        <Section title="资源占用" desc="前端应用的卡顿多来自 objectURL 与图片缓存，这里可实时查看并清理。">
          {res ? (
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">JS 内存</span>
                <span className="tabular-nums">
                  {res.heapLimit ? `${(res.heapUsed / 1024 / 1024).toFixed(0)} MB` : '浏览器未提供'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">站点存储用量</span>
                <span className="tabular-nums">
                  {fmtBytes(res.storageUsed)}
                  {res.storageQuota ? ` / ${fmtBytes(res.storageQuota)}` : ''}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">音视频条目</span>
                <span className="tabular-nums">
                  {res.audioCount} 个 · {fmtBytes(res.audioBytes)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">URL / 图片 / VAD 缓存</span>
                <span className="tabular-nums">
                  {res.urlCache} / {res.imageCache} / {res.vaCache}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">DOM 节点</span>
                <span className="tabular-nums">{res.domNodes}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">正在统计…</p>
          )}
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={async () => {
              const r = await runCleanup();
              setCleanMsg(
                `已释放 URL ${r.freedUrls} · 图片 ${r.freedImages} · VAD ${r.freedVA}${
                  r.orphanRemoved ? ` · 孤儿文件 ${r.orphanRemoved}（${fmtBytes(r.orphanBytes)}）` : ''
                }`,
              );
              setRes(await readResources());
            }}
          >
            <Database className="mr-1 h-3.5 w-3.5" /> 立即清理缓存
          </Button>
          {cleanMsg ? <p className="mt-2 text-xs text-emerald-600">{cleanMsg}</p> : null}
        </Section>

        <Section title="数据删除" desc="删除即时生效，不可恢复。">
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>· 删除单条训练录音：在复盘页点击记录右上角删除按钮。</p>
            <p>· 删除素材及关联记录：素材库或素材详情页的删除入口。</p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="mt-3"
            onClick={() => {
              if (confirm('删除全部素材、录音、训练记录、术语库与计划？该操作不可恢复。')) {
                wipe();
                alert('已清除全部本地数据');
              }
            }}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" /> 删除账号及全部数据
          </Button>
        </Section>

        <Section title="隐私与合规">
          <div className="space-y-2 text-xs text-muted-foreground">
            <p className="flex gap-1.5">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              纯本地存储：音频与记录保存在本机浏览器（IndexedDB），不上传云端，无公开素材库、无社交展示。
            </p>
            <p className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              换设备或清理浏览器数据会导致本地内容丢失，可用「记录导出」做备份。
            </p>
            <p>语音数据属于个人信息，仅你本人可访问；请勿在公共设备上保存敏感素材。</p>
          </div>
        </Section>

        <Section title="快捷键" desc="键盘覆盖核心训练操作，减少操作摩擦。" className="lg:col-span-2">
          <div className="grid gap-1 sm:grid-cols-2">
            {HOTKEYS.map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 rounded px-1 py-0.5 text-xs odd:bg-muted/40">
                <Keyboard className="h-3 w-3 text-muted-foreground" />
                <span className="w-24 shrink-0 rounded bg-muted px-1.5 py-0.5 text-center font-mono text-[11px]">{k}</span>
                <span className="text-muted-foreground">{v}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
