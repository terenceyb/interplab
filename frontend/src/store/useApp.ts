import { create } from 'zustand';
import * as db from '@/lib/db';
import type { GlossaryLib, GlossaryTerm, Material, PlanGoal, Profile, Session, VocabItem } from '@/types';

interface AppState {
  ready: boolean;
  materials: Material[];
  sessions: Session[];
  libs: GlossaryLib[];
  terms: GlossaryTerm[];
  vocab: VocabItem[];
  plan: PlanGoal[];
  profile: Profile;
  init: () => Promise<void>;
  refreshMaterials: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  saveMaterial: (m: Material) => Promise<void>;
  removeMaterial: (id: string) => Promise<void>;
  saveSession: (s: Session) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  removeAttempt: (sessionId: string, attemptId: string) => Promise<void>;
  saveTerm: (t: GlossaryTerm) => Promise<void>;
  removeTerm: (id: string) => Promise<void>;
  saveLib: (l: GlossaryLib) => Promise<void>;
  removeLib: (id: string) => Promise<void>;
  saveVocab: (v: VocabItem) => Promise<void>;
  removeVocab: (id: string) => Promise<void>;
  setPlan: (p: PlanGoal[]) => Promise<void>;
  setProfile: (p: Profile) => Promise<void>;
  wipe: () => Promise<void>;
}

const urlCache = new Map<string, string>();

export async function audioUrl(key: string): Promise<string> {
  const hit = urlCache.get(key);
  if (hit) return hit;
  const blob = await db.getAudio(key);
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  materials: [],
  sessions: [],
  libs: [],
  terms: [],
  vocab: [],
  plan: [],
  profile: { name: '我', createdAt: Date.now(), storageMode: 'local' },
  async init() {
    const [materials, sessions, libs, terms, vocab, plan, profile] = await Promise.all([
      db.listMaterials(),
      db.listSessions(),
      db.listLibs(),
      db.listTerms(),
      db.listVocab(),
      db.getPlan(),
      db.getProfile(),
    ]);
    set({ materials, sessions, libs, terms, vocab, plan, profile, ready: true });
  },
  async refreshMaterials() {
    set({ materials: await db.listMaterials() });
  },
  async refreshSessions() {
    set({ sessions: await db.listSessions() });
  },
  async saveMaterial(m) {
    await db.putMaterial(m);
    await get().refreshMaterials();
  },
  async removeMaterial(id) {
    await db.deleteMaterial(id);
    await get().refreshMaterials();
    await get().refreshSessions();
  },
  async saveSession(s) {
    await db.putSession(s);
    await get().refreshSessions();
  },
  async removeSession(id) {
    await db.deleteSession(id);
    await get().refreshSessions();
  },
  async removeAttempt(sessionId, attemptId) {
    await db.deleteAttempt(sessionId, attemptId);
    await get().refreshSessions();
  },
  async saveTerm(t) {
    await db.putTerm(t);
    set({ terms: await db.listTerms() });
  },
  async removeTerm(id) {
    await db.deleteTerm(id);
    set({ terms: await db.listTerms() });
  },
  async saveLib(l) {
    await db.putLib(l);
    set({ libs: await db.listLibs() });
  },
  async removeLib(id) {
    await db.deleteLib(id);
    set({ libs: await db.listLibs(), terms: await db.listTerms() });
  },
  async saveVocab(v) {
    await db.putVocab(v);
    set({ vocab: await db.listVocab() });
  },
  async removeVocab(id) {
    await db.deleteVocab(id);
    set({ vocab: await db.listVocab() });
  },
  async setPlan(p) {
    await db.putPlan(p);
    set({ plan: p });
  },
  async setProfile(p) {
    await db.putProfile(p);
    set({ profile: p });
  },
  async wipe() {
    await db.wipeAll();
    urlCache.clear();
    set({ materials: [], sessions: [], libs: [], terms: [], vocab: [], plan: [] });
  },
}));
