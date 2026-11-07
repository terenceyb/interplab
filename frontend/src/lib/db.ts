import { openDB, type IDBPDatabase } from 'idb';
import type {
  Attempt,
  ExportLog,
  GlossaryLib,
  GlossaryTerm,
  Material,
  PlanGoal,
  Profile,
  Session,
  VocabItem,
} from '@/types';

const DB_NAME = 'interplab';
const DB_VERSION = 1;

export interface StoredMaterial extends Omit<Material, 'audioKey'> {
  audioKey: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        d.createObjectStore('audio', { keyPath: 'key' });
        d.createObjectStore('materials', { keyPath: 'id' });
        d.createObjectStore('sessions', { keyPath: 'id' });
        d.createObjectStore('glossaryLibs', { keyPath: 'id' });
        d.createObjectStore('glossaryTerms', { keyPath: 'id' });
        d.createObjectStore('vocab', { keyPath: 'id' });
        d.createObjectStore('meta', { keyPath: 'k' });
        d.createObjectStore('exports', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/* ---------------- 音频二进制 ---------------- */

export async function putAudio(blob: Blob, key = uid()): Promise<string> {
  const d = await db();
  await d.put('audio', { key, blob, size: blob.size, at: Date.now() });
  return key;
}

export async function getAudio(key: string): Promise<Blob | undefined> {
  const d = await db();
  const r = await d.get('audio', key);
  return r?.blob as Blob | undefined;
}

export async function deleteAudio(keys: string[]) {
  const d = await db();
  const tx = d.transaction('audio', 'readwrite');
  await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
}

/* ---------------- 素材 ---------------- */

export async function listMaterials(): Promise<Material[]> {
  const d = await db();
  const all = (await d.getAll('materials')) as Material[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function putMaterial(m: Material) {
  const d = await db();
  await d.put('materials', m);
}

export async function getMaterial(id: string): Promise<Material | undefined> {
  const d = await db();
  return d.get('materials', id);
}

export async function deleteMaterial(id: string) {
  const d = await db();
  const m = (await d.get('materials', id)) as Material | undefined;
  const sessions = (await d.getAll('sessions')) as Session[];
  const mine = sessions.filter((s) => s.materialId === id);
  const keys = [m?.audioKey, ...mine.flatMap((s) => s.attempts.map((a) => a.audioKey))].filter(
    Boolean,
  ) as string[];
  await deleteAudio(keys);
  const tx = d.transaction(['materials', 'sessions'], 'readwrite');
  await tx.objectStore('materials').delete(id);
  const ss = tx.objectStore('sessions');
  await Promise.all(mine.map((s) => ss.delete(s.id)));
  await tx.done;
}

/* ---------------- 训练记录 ---------------- */

export async function listSessions(): Promise<Session[]> {
  const d = await db();
  const all = (await d.getAll('sessions')) as Session[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function putSession(s: Session) {
  const d = await db();
  await d.put('sessions', s);
}

export async function getSession(id: string): Promise<Session | undefined> {
  const d = await db();
  return d.get('sessions', id);
}

export async function deleteSession(id: string) {
  const d = await db();
  const s = (await d.get('sessions', id)) as Session | undefined;
  if (!s) return;
  await deleteAudio(s.attempts.map((a) => a.audioKey));
  await d.delete('sessions', id);
}

export async function deleteAttempt(sessionId: string, attemptId: string) {
  const d = await db();
  const s = (await d.get('sessions', sessionId)) as Session | undefined;
  if (!s) return;
  const a = s.attempts.find((x) => x.id === attemptId);
  if (a) await deleteAudio([a.audioKey]);
  s.attempts = s.attempts.filter((x) => x.id !== attemptId);
  await d.put('sessions', s);
}

/* ---------------- 术语库 / 生词本 ---------------- */

export async function listLibs(): Promise<GlossaryLib[]> {
  const d = await db();
  return (await d.getAll('glossaryLibs')) as GlossaryLib[];
}
export async function putLib(l: GlossaryLib) {
  const d = await db();
  await d.put('glossaryLibs', l);
}
export async function deleteLib(id: string) {
  const d = await db();
  const terms = (await d.getAll('glossaryTerms')) as GlossaryTerm[];
  const tx = d.transaction(['glossaryLibs', 'glossaryTerms'], 'readwrite');
  await tx.objectStore('glossaryLibs').delete(id);
  const ts = tx.objectStore('glossaryTerms');
  await Promise.all(terms.filter((t) => t.libId === id).map((t) => ts.delete(t.id)));
  await tx.done;
}
export async function listTerms(): Promise<GlossaryTerm[]> {
  const d = await db();
  return (await d.getAll('glossaryTerms')) as GlossaryTerm[];
}
export async function putTerm(t: GlossaryTerm) {
  const d = await db();
  await d.put('glossaryTerms', t);
}
export async function deleteTerm(id: string) {
  const d = await db();
  await d.delete('glossaryTerms', id);
}

export async function listVocab(): Promise<VocabItem[]> {
  const d = await db();
  const all = (await d.getAll('vocab')) as VocabItem[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export async function putVocab(v: VocabItem) {
  const d = await db();
  await d.put('vocab', v);
}
export async function deleteVocab(id: string) {
  const d = await db();
  await d.delete('vocab', id);
}

/* ---------------- meta（档案 / 计划 / 导出日志） ---------------- */

async function getMeta<T>(k: string, fallback: T): Promise<T> {
  const d = await db();
  const r = await d.get('meta', k);
  return r ? (r.v as T) : fallback;
}
async function setMeta<T>(k: string, v: T) {
  const d = await db();
  await d.put('meta', { k, v });
}

export const getProfile = () => getMeta<Profile>('profile', { name: '我', createdAt: Date.now(), storageMode: 'local' });
export const putProfile = (p: Profile) => setMeta('profile', p);
export const getPlan = () => getMeta<PlanGoal[]>('plan', []);
export const putPlan = (p: PlanGoal[]) => setMeta('plan', p);
export async function getExportLogs(): Promise<ExportLog[]> {
  const d = await db();
  const all = (await d.getAll('exports')) as ExportLog[];
  return all.sort((a, b) => b.at - a.at).slice(0, 20);
}

export async function logExport(kind: string, count: number) {
  const d = await db();
  const item: ExportLog = { id: uid(), at: Date.now(), kind, count };
  await d.put('exports', item);
}

/* ---------------- 全量清除 ---------------- */

export async function wipeAll() {
  const d = await db();
  const tx = d.transaction(
    ['audio', 'materials', 'sessions', 'glossaryLibs', 'glossaryTerms', 'vocab', 'meta', 'exports'],
    'readwrite',
  );
  await Promise.all(
    ['audio', 'materials', 'sessions', 'glossaryLibs', 'glossaryTerms', 'vocab', 'meta', 'exports'].map(
      (s) => tx.objectStore(s).clear(),
    ),
  );
  await tx.done;
}

export async function estimateUsage(): Promise<{ bytes: number; count: number }> {
  const d = await db();
  const all = await d.getAll('audio');
  return { bytes: all.reduce((s: number, r: { size?: number }) => s + (r.size || 0), 0), count: all.length };
}

/** 下一次轮次号：同素材同模式的第 N 轮 */
export async function nextAttemptNumber(materialId: string, mode: string): Promise<number> {
  const sessions = await listSessions();
  return sessions.filter((s) => s.materialId === materialId && s.mode === mode).length + 1;
}

export type { Attempt };
