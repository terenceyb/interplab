import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Presentation, Trash2, Upload } from 'lucide-react';
import { SCRIPT_ACCEPT, SLIDE_ACCEPT, parseScriptFile, type ParsedDoc } from '@/lib/document';
import { cn } from '@/lib/utils';

interface Props {
  /** 已载入的幻灯片页数 */
  slideCount?: number;
  slidesFile?: string;
  slidesSource?: string;
  /** 已载入的稿件：文件名与句数 */
  scriptFile?: string;
  sentenceCount?: number;
  blockCount?: number;
  onSlides: (doc: ParsedDoc | null, fileName?: string) => void | Promise<void>;
  onScript: (doc: ParsedDoc | null, fileName?: string) => void | Promise<void>;
  dark?: boolean;
  /** 只显示某一类入口：无稿同传只需幻灯片 */
  only?: 'both' | 'slides' | 'script';
  /** 宽容器时两个入口并排（默认竖排，适配窄侧栏） */
  wide?: boolean;
  /** 是否允许移除（训练中一般不允许） */
  removable?: boolean;
  className?: string;
}

type Busy = 'slides' | 'script' | null;

/**
 * 两类材料的上传入口：
 * 1) 幻灯片（PPT / PPTX / PDF / ODP）—— 按页呈现，手动翻页；
 * 2) 稿件（Word / TXT / 字幕）—— 连续文稿，可按时间码跟随。
 * 两个入口分开，互不覆盖：带稿同传可以同时挂 PPT 和文字稿。
 */
export function DocSlots({
  slideCount = 0,
  slidesFile,
  slidesSource,
  scriptFile,
  sentenceCount = 0,
  blockCount = 0,
  onSlides,
  onScript,
  dark = false,
  only = 'both',
  wide = false,
  removable = true,
  className,
}: Props) {
  const slideRef = useRef<HTMLInputElement>(null);
  const scriptRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 提示 8 秒后自动消失，避免换文件后旧提示误导
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 8000);
    return () => clearTimeout(id);
  }, [msg]);

  const run = async (kind: Exclude<Busy, null>, file: File) => {
    setBusy(kind);
    setMsg(null);
    try {
      const doc = await parseScriptFile(file);
      const warn = doc.warnings?.length ? ` · ${doc.warnings.join('；')}` : '';
      if (doc.kind === 'slides' && doc.slides?.length) {
        await onSlides(doc, file.name);
        setMsg({
          ok: true,
          text: `已载入 ${doc.slides.length} 页幻灯片（${doc.source}${doc.encoding ? ` · ${doc.encoding}` : ''}）${
            only === 'script' ? '，已归入「PPT / PDF 幻灯片」' : ''
          }${warn}`,
        });
      } else {
        await onScript(doc, file.name);
        setMsg({
          ok: true,
          text: `已读取 ${doc.blocks?.length ?? 0} 段文字（${doc.source}${doc.encoding ? ` · ${doc.encoding}` : ''}）${
            only === 'slides' ? '，已归入「讲话稿 / 字幕」' : ''
          }${warn}`,
        });
      }
    } catch (e: any) {
      setMsg({ ok: false, text: String(e?.message || e) });
    } finally {
      setBusy(null);
    }
  };

  const card = dark
    ? 'rounded-lg border border-white/10 bg-white/[0.03] p-3'
    : 'rounded-lg border bg-card p-3';
  const titleCls = dark ? 'text-xs font-medium text-slate-200' : 'text-xs font-medium';
  const descCls = dark ? 'text-[11px] text-slate-500' : 'text-[11px] text-muted-foreground';
  const btnCls = dark
    ? 'flex h-8 items-center gap-1.5 rounded-md border border-white/15 px-2.5 text-[11px] text-slate-200 transition-colors hover:bg-white/10 disabled:opacity-50'
    : 'flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] transition-colors hover:bg-muted disabled:opacity-50';

  return (
    <div className={cn('space-y-2', className)}>
      <div className={cn('grid grid-cols-1 gap-2', wide && only === 'both' ? 'sm:grid-cols-2' : '')}>
        {/* 幻灯片入口 */}
        {only !== 'script' ? <div className={card}>
          <div className="flex items-start gap-2">
            <Presentation className={cn('mt-0.5 h-4 w-4 shrink-0', dark ? 'text-sky-400' : 'text-primary')} />
            <div className="min-w-0 flex-1">
              <div className={titleCls}>PPT / PDF 幻灯片</div>
              <div className={descCls}>
                {slideCount
                  ? `${slideCount} 页${slidesSource ? ` · ${slidesSource}` : ''}${slidesFile ? ` · ${slidesFile}` : ''}`
                  : '支持 .pptx .pptm .ppsx .ppt .pdf .odp'}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <button className={btnCls} disabled={busy !== null} onClick={() => slideRef.current?.click()}>
              {busy === 'slides' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              {busy === 'slides' ? '解析中…' : slideCount ? '更换' : '上传'}
            </button>
            {slideCount && removable ? (
              <button
                className={cn(btnCls, 'text-rose-400')}
                disabled={busy !== null}
                onClick={() => {
                  void onSlides(null);
                  setMsg(null);
                }}
              >
                <Trash2 className="h-3 w-3" /> 移除
              </button>
            ) : null}
          </div>
          <input
            ref={slideRef}
            type="file"
            accept={SLIDE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void run('slides', f);
            }}
          />
        </div> : null}

        {/* 稿件入口 */}
        {only !== 'slides' ? <div className={card}>
          <div className="flex items-start gap-2">
            <FileText className={cn('mt-0.5 h-4 w-4 shrink-0', dark ? 'text-amber-400' : 'text-amber-600')} />
            <div className="min-w-0 flex-1">
              <div className={titleCls}>讲话稿 / 字幕</div>
              <div className={descCls}>
                {sentenceCount
                  ? `${blockCount} 段 · ${sentenceCount} 句${scriptFile ? ` · ${scriptFile}` : ''}`
                  : '支持 .docx .txt .md .srt .vtt .rtf，自动识别编码'}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <button className={btnCls} disabled={busy !== null} onClick={() => scriptRef.current?.click()}>
              {busy === 'script' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              {busy === 'script' ? '解析中…' : sentenceCount ? '更换' : '上传'}
            </button>
            {sentenceCount && removable ? (
              <button
                className={cn(btnCls, 'text-rose-400')}
                disabled={busy !== null}
                onClick={() => {
                  void onScript(null);
                  setMsg(null);
                }}
              >
                <Trash2 className="h-3 w-3" /> 移除
              </button>
            ) : null}
          </div>
          <input
            ref={scriptRef}
            type="file"
            accept={SCRIPT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void run('script', f);
            }}
          />
        </div> : null}
      </div>

      {msg ? (
        <div
          className={cn(
            'flex items-start gap-2 rounded-md border p-2 text-[11px]',
            msg.ok
              ? dark
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : 'border-emerald-500/30 bg-emerald-500/10'
              : dark
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                : 'border-amber-500/30 bg-amber-500/10',
          )}
        >
          <span className="flex-1">{msg.text}</span>
          <button className="shrink-0 opacity-60 hover:opacity-100" onClick={() => setMsg(null)}>
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
