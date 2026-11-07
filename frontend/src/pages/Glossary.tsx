import { useMemo, useRef, useState } from 'react';
import { BookMarked, Check, Download, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader, Section, Empty } from '@/components/PageHeader';
import { useApp } from '@/store/useApp';
import * as db from '@/lib/db';
import { download } from '@/lib/export';
import type { GlossaryTerm } from '@/types';

export default function Glossary() {
  const { libs, terms, vocab, saveLib, removeLib, saveTerm, removeTerm, saveVocab, removeVocab } = useApp();
  const [libId, setLibId] = useState(libs[0]?.id || '');
  const [newLib, setNewLib] = useState('');
  const [draft, setDraft] = useState({ term: '', translation: '', note: '' });
  const [kw, setKw] = useState('');
  const [tab, setTab] = useState<'terms' | 'cards' | 'vocab'>('terms');
  const fileRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const k = kw.trim().toLowerCase();
    return terms
      .filter((t) => (!libId || t.libId === libId) && (!k || t.term.toLowerCase().includes(k) || t.translation.toLowerCase().includes(k)))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [terms, libId, kw]);

  const addTerm = async () => {
    if (!draft.term.trim() || !libId) return;
    await saveTerm({
      id: db.uid(),
      libId,
      term: draft.term.trim(),
      translation: draft.translation.trim(),
      note: draft.note.trim(),
      mastered: false,
      createdAt: Date.now(),
    });
    setDraft({ term: '', translation: '', note: '' });
  };

  const importCsv = async (file: File) => {
    const text = await file.text();
    const rows = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(1); // 跳过表头
    let n = 0;
    for (const r of rows) {
      const [term, translation, note] = r.split(/,|\t/).map((x) => x.replace(/^"|"$/g, '').trim());
      if (!term) continue;
      await saveTerm({ id: db.uid(), libId, term, translation: translation || '', note: note || '', mastered: false, createdAt: Date.now() });
      n++;
    }
    alert(`已导入 ${n} 条术语`);
  };

  const exportCsv = () => {
    const rows = [['术语', '释义', '备注', '已掌握']];
    for (const t of list) rows.push([t.term, t.translation, t.note || '', t.mastered ? '是' : '否']);
    download(`术语库-${libs.find((l) => l.id === libId)?.name || '全部'}.csv`, rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n'), 'text/csv');
  };

  return (
    <>
      <PageHeader
        title="个人术语库与生词本"
        desc="术语准备贯穿素材准备、训练和复盘。支持手动录入、CSV 导入、从稿件提取、闪卡复习。"
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-3.5 w-3.5" /> 导入 CSV
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.tsv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])}
            />
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <Download className="mr-1 h-3.5 w-3.5" /> 导出 CSV
            </Button>
          </>
        }
      />

      <div className="mx-6 mt-4 flex flex-wrap items-center gap-2">
        <Select value={libId} onValueChange={setLibId}>
          <SelectTrigger className="w-48">
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
        <Input className="h-8 w-40" placeholder="新建术语库名称" value={newLib} onChange={(e) => setNewLib(e.target.value)} />
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            if (!newLib.trim()) return;
            const id = db.uid();
            await saveLib({ id, name: newLib.trim(), createdAt: Date.now() });
            setLibId(id);
            setNewLib('');
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> 新建
        </Button>
        {libId ? (
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => confirm('删除该术语库及其全部词条？') && removeLib(libId)}>
            <Trash2 className="mr-1 h-3.5 w-3.5" /> 删除本库
          </Button>
        ) : null}
        <div className="ml-auto flex gap-1">
          {(['terms', 'cards', 'vocab'] as const).map((k) => (
            <Button key={k} size="sm" variant={tab === k ? 'default' : 'outline'} onClick={() => setTab(k)}>
              {k === 'terms' ? '术语列表' : k === 'cards' ? '记忆卡片' : `生词本 ${vocab.length}`}
            </Button>
          ))}
        </div>
      </div>

      {tab === 'terms' ? (
        <div className="grid gap-4 p-6 lg:grid-cols-3">
          <Section title="添加术语" className="lg:col-span-1">
            <div className="space-y-2">
              <div>
                <Label className="text-xs">术语 / 原文</Label>
                <Input className="h-8" value={draft.term} onChange={(e) => setDraft({ ...draft, term: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">译法 / 释义</Label>
                <Input className="h-8" value={draft.translation} onChange={(e) => setDraft({ ...draft, translation: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">备注</Label>
                <Textarea className="min-h-[60px] text-xs" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
              </div>
              <Button size="sm" className="w-full" onClick={addTerm} disabled={!draft.term.trim() || !libId}>
                <Plus className="mr-1 h-3.5 w-3.5" /> 加入术语库
              </Button>
              {!libId ? <p className="text-xs text-muted-foreground">请先新建或选择一个术语库</p> : null}
            </div>
          </Section>

          <Section
            title={`术语列表（${list.length}）`}
            className="lg:col-span-2"
            actions={<Input className="h-8 w-40" placeholder="搜索术语" value={kw} onChange={(e) => setKw(e.target.value)} />}
          >
            <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
              {list.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium">{t.term}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{t.translation}</span>
                  <Badge variant={t.mastered ? 'secondary' : 'outline'} className="shrink-0 text-[10px]">
                    {t.mastered ? '已掌握' : '待复习'}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0"
                    title="切换掌握状态"
                    onClick={() => saveTerm({ ...t, mastered: !t.mastered })}
                  >
                    <Check className={`h-3 w-3 ${t.mastered ? 'text-emerald-600' : ''}`} />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-destructive" onClick={() => removeTerm(t.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {!list.length ? (
                <Empty icon={<BookMarked className="h-5 w-5 text-muted-foreground" />} text="还没有术语，可手动添加、导入 CSV，或在素材页从稿件提取" />
              ) : null}
            </div>
          </Section>
        </div>
      ) : null}

      {tab === 'cards' ? <FlashCards terms={terms.filter((t) => !libId || t.libId === libId)} onUpdate={saveTerm} /> : null}

      {tab === 'vocab' ? (
        <div className="p-6">
          <VocabPanel vocab={vocab} onAdd={saveVocab} onRemove={removeVocab} />
        </div>
      ) : null}
    </>
  );
}

function FlashCards({ terms, onUpdate }: { terms: GlossaryTerm[]; onUpdate: (t: GlossaryTerm) => Promise<void> }) {
  const queue = terms.filter((t) => !t.mastered);
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const cur = queue[i];

  if (!cur) {
    return (
      <div className="p-6">
        <Empty icon={<BookMarked className="h-5 w-5 text-muted-foreground" />} text="没有待复习的词条，全部已掌握" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <Section title={`记忆卡片（待复习 ${queue.length}）`} desc="点击卡片翻面，标记「已掌握」后从队列中移除。">
        <div className="mx-auto max-w-md">
          <button
            onClick={() => setFlip((f) => !f)}
            className="flex h-48 w-full flex-col items-center justify-center rounded-lg border bg-card p-6 text-center transition-colors hover:bg-accent"
          >
            <div className="text-xs text-muted-foreground">{flip ? '译法 / 释义' : '术语 / 原文'}</div>
            <div className="mt-3 text-xl font-semibold">{flip ? cur.translation || '（未填写释义）' : cur.term}</div>
            {cur.note ? <div className="mt-2 text-xs text-muted-foreground">{cur.note}</div> : null}
          </button>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setFlip(false);
                setI((v) => (v + 1) % queue.length);
              }}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> 下一个
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={async () => {
                await onUpdate({ ...cur, mastered: true });
                setFlip(false);
                setI((v) => Math.min(v, Math.max(0, queue.length - 2)));
              }}
            >
              <Check className="mr-1 h-3.5 w-3.5" /> 已掌握
            </Button>
          </div>
          <div className="mt-2 text-center text-xs text-muted-foreground">
            {i + 1} / {queue.length}
          </div>
        </div>
      </Section>
    </div>
  );
}

function VocabPanel({
  vocab,
  onAdd,
  onRemove,
}: {
  vocab: { id: string; word: string; note?: string; from: string; createdAt: number }[];
  onAdd: (v: any) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [word, setWord] = useState('');
  const [note, setNote] = useState('');
  return (
    <Section title="生词本" desc="复盘时标记为「用词不当 / 不认识」的词可在此记录，也可手动添加。">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <Label className="text-xs">词 / 表达</Label>
          <Input className="mt-1 h-8" value={word} onChange={(e) => setWord(e.target.value)} />
        </div>
        <div className="flex-1">
          <Label className="text-xs">备注</Label>
          <Input className="mt-1 h-8" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button
          size="sm"
          onClick={async () => {
            if (!word.trim()) return;
            await onAdd({ id: db.uid(), word: word.trim(), note: note.trim(), from: '手动添加', createdAt: Date.now() });
            setWord('');
            setNote('');
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> 添加
        </Button>
      </div>
      <div className="mt-3 space-y-1">
        {vocab.map((v) => (
          <div key={v.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate font-medium">{v.word}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{v.note}</span>
            <Badge variant="outline" className="text-[10px]">
              {v.from}
            </Badge>
            <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => onRemove(v.id)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
        {!vocab.length ? <p className="py-6 text-center text-xs text-muted-foreground">生词本还是空的</p> : null}
      </div>
    </Section>
  );
}
