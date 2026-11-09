/**
 * 数据包（.ipkg / .zip）导入导出 + 本地文件夹批量导入。
 *
 * 数据包结构：
 *   interplab.json          素材清单 / 训练记录 / 术语库 / 计划
 *   media/<key>.<ext>       源语音视频、译语录音、幻灯片配图
 *   README.txt              说明
 */
import { computePeaks, decodeFile, detectSilenceEdges, probeMediaDuration } from '@/lib/audio';
import { SLIDE_IMG_PREFIX, isSlideDoc, isScriptDoc, parseScriptFile } from '@/lib/document';
import { buildScriptPatch } from '@/lib/scriptAttach';
import * as db from '@/lib/db';
import type { GlossaryLib, GlossaryTerm, Material, PlanGoal, Profile, Session, SlideData, VocabItem } from '@/types';

export interface PackagePayload {
  materials: Material[];
  sessions: Session[];
  libs: GlossaryLib[];
  terms: GlossaryTerm[];
  vocab: VocabItem[];
  plan: PlanGoal[];
  profile: Profile;
}

export type Progress = (pct: number, msg: string) => void;

const EXT_BY_MIME: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

function extOf(blob: Blob, fallback = 'bin'): string {
  const t = (blob.type || '').split(';')[0];
  return EXT_BY_MIME[t] || fallback;
}

/* ------------------------------------------------------------------ */
/* 导出                                                                */
/* ------------------------------------------------------------------ */

export async function exportPackage(
  data: PackagePayload,
  opts: { includeAudio?: boolean } = {},
  onProgress?: Progress,
): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const includeAudio = opts.includeAudio !== false;
  const media = zip.folder('media')!;
  const mediaMap: Record<string, string> = {};
  let step = 0;

  const total =
    data.materials.length * 2 + data.sessions.reduce((a, s) => a + s.attempts.length, 0) + 4;
  const tick = (msg: string) => onProgress?.(Math.min(99, Math.round((++step / total) * 100)), msg);

  const putBlob = async (key: string, blob: Blob, prefix = '') => {
    if (!includeAudio) return '';
    const name = `${prefix}${key}.${extOf(blob)}`;
    media.file(name, blob);
    return `media/${name}`;
  };

  // 素材：源语 + 幻灯片配图
  const materials: any[] = [];
  for (const m of data.materials) {
    tick(`打包素材 ${m.title}`);
    const audio = await db.getAudio(m.audioKey).catch(() => undefined);
    const audioFile = audio ? await putBlob(m.audioKey, audio) : '';
    const imageMap: Record<string, string> = {};
    for (const s of m.slides || []) {
      for (const src of s.images || []) {
        if (!src.startsWith(SLIDE_IMG_PREFIX)) continue;
        const key = src.slice(SLIDE_IMG_PREFIX.length);
        const blob = await db.getAudio(key).catch(() => undefined);
        if (!blob) continue;
        const path = await putBlob(key, blob);
        if (path) {
          mediaMap[key] = path;
          imageMap[src] = path;
        }
      }
    }
    // 原始 PPT/PDF 一起打包，导入后还能按原版式看稿
    let srcFile = '';
    if (m.slidesBlobKey) {
      const srcBlob = await db.getAudio(m.slidesBlobKey).catch(() => undefined);
      if (srcBlob) srcFile = await putBlob(m.slidesBlobKey, srcBlob, 'src-');
    }
    materials.push({ ...m, __audioFile: audioFile, __imageMap: imageMap, __srcFile: srcFile });
  }

  // 训练记录：译语录音
  const sessions: any[] = [];
  for (const s of data.sessions) {
    tick(`打包训练记录 ${s.materialTitle}`);
    const attempts: any[] = [];
    for (const a of s.attempts) {
      const blob = await db.getAudio(a.audioKey).catch(() => undefined);
      const file = blob ? await putBlob(a.audioKey, blob, 'take-') : '';
      attempts.push({ ...a, __audioFile: file });
    }
    sessions.push({ ...s, attempts });
  }

  tick('写入清单');
  zip.file(
    'interplab.json',
    JSON.stringify(
      {
        app: 'interplab',
        version: 2,
        exportedAt: new Date().toISOString(),
        withAudio: includeAudio,
        materials,
        sessions,
        libs: data.libs,
        terms: data.terms,
        vocab: data.vocab,
        plan: data.plan,
        profile: data.profile,
      },
      null,
      2,
    ),
  );

  zip.file(
    'README.txt',
    [
      'InterpLab 数据包',
      `导出时间：${new Date().toLocaleString('zh-CN')}`,
      '',
      '结构：',
      '  interplab.json  素材、训练记录、术语库、计划',
      '  media/          源语音视频、译语录音、幻灯片配图',
      '',
      '导入方式：在 InterpLab「数据与设置 → 数据包」中选择本文件（.ipkg 或 .zip）。',
      '也可以在本地按下面结构放文件后整包导入：',
      '  任意目录/*.mp3 + 同名 *.docx / *.pptx / *.pdf （同名自动配对成一条素材）',
    ].join('\n'),
  );

  tick('压缩中');
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } }, (meta) =>
    onProgress?.(Math.min(99, 60 + Math.round(meta.percent * 0.4)), '压缩中…'),
  );
}

/* ------------------------------------------------------------------ */
/* 导入数据包                                                          */
/* ------------------------------------------------------------------ */

export interface ImportResult {
  materials: number;
  sessions: number;
  terms: number;
  skipped: number;
  warnings: string[];
}

export async function importPackage(
  file: File,
  onProgress?: Progress,
): Promise<ImportResult> {
  if (/\.json$/i.test(file.name)) {
    throw new Error(
      '这是「记录导出」生成的 JSON 归档，只有文字记录、不含音视频，无法直接恢复训练。请改用数据包（.ipkg / .zip）。',
    );
  }
  let zip: any;
  try {
    const { default: JSZip } = await import('jszip');
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error('文件不是有效的压缩包，无法作为数据包导入');
  }
  const manifestFile = zip.file('interplab.json') || zip.file(/interplab.*\.json$/)[0];
  if (!manifestFile) {
    throw new Error('不是有效的 InterpLab 数据包（缺少 interplab.json）');
  }
  onProgress?.(10, '读取清单');
  const raw = JSON.parse(await manifestFile.async('string'));
  if (raw?.app && raw.app !== 'interplab') throw new Error('数据包来源不明，已拒绝导入');

  const warnings: string[] = [];
  const result: ImportResult = { materials: 0, sessions: 0, terms: 0, skipped: 0, warnings };

  /** 从 zip 里还原 blob 并换成新的 key */
  const restore = async (path?: string): Promise<string> => {
    if (!path) return '';
    const f = zip.file(path);
    if (!f) return '';
    const blob = await f.async('blob');
    return db.putAudio(blob);
  };

  const list: any[] = Array.isArray(raw.materials) ? raw.materials : [];
  const idMap = new Map<string, string>();
  const materialIndex = new Map<string, Material>();

  for (let i = 0; i < list.length; i++) {
    const src = list[i];
    onProgress?.(10 + Math.round((i / Math.max(1, list.length)) * 50), `导入素材 ${src.title || ''}`);
    try {
      const audioKey = await restore(src.__audioFile);
      const slidesBlobKey = src.__srcFile ? (await restore(src.__srcFile)) || undefined : undefined;
      if (!audioKey) {
        result.skipped++;
        warnings.push(`「${src.title}」缺少源语文件，已跳过`);
        continue;
      }
      const blob = await db.getAudio(audioKey);
      let duration = src.duration || 0;
      let peaks = src.peaks || [];
      let sampleRate = src.sampleRate || 48000;
      let trim = src.trim || { start: 0, end: duration };
      if (blob && (!duration || !peaks?.length)) {
        try {
          const decoded = await decodeFile(blob);
          duration = decoded.duration;
          sampleRate = decoded.sampleRate;
          peaks = computePeaks(decoded.buffer);
          trim = detectSilenceEdges(decoded.buffer);
        } catch {
          duration = await probeMediaDuration(blob);
          trim = { start: 0, end: duration };
        }
      }
      const slides: SlideData[] | undefined = Array.isArray(src.slides)
        ? await Promise.all(
            src.slides.map(async (s: SlideData) => {
              const images: string[] = [];
              for (const img of s.images || []) {
                const path = src.__imageMap?.[img];
                const key = path ? await restore(path) : '';
                if (key) images.push(SLIDE_IMG_PREFIX + key);
              }
              return { ...s, images };
            }),
          )
        : undefined;

      const id = db.uid();
      idMap.set(src.id, id);
      const material: Material = {
        ...src,
        id,
        audioKey,
        duration,
        peaks,
        sampleRate,
        trim,
        slides,
        slidesBlobKey,
        createdAt: src.createdAt || Date.now(),
        sentences: Array.isArray(src.sentences) ? src.sentences : [],
        tags: Array.isArray(src.tags) ? src.tags : [],
        favorite: !!src.favorite,
        difficulty: src.difficulty || 'medium',
        accent: src.accent || '',
        speechRate: src.speechRate || '',
      };
      delete (material as any).__audioFile;
      delete (material as any).__imageMap;
      delete (material as any).__srcFile;
      await db.putMaterial(material);
      materialIndex.set(src.id, material);
      result.materials++;
    } catch (e: any) {
      result.skipped++;
      warnings.push(`「${src.title}」导入失败：${e?.message || e}`);
    }
  }

  const sessionList: any[] = Array.isArray(raw.sessions) ? raw.sessions : [];
  for (let i = 0; i < sessionList.length; i++) {
    const src = sessionList[i];
    onProgress?.(60 + Math.round((i / Math.max(1, sessionList.length)) * 30), `导入记录 ${src.materialTitle || ''}`);
    const mat = materialIndex.get(src.materialId);
    if (!mat) {
      result.skipped++;
      continue;
    }
    try {
      const id = db.uid();
      const attempts = [];
      for (const a of src.attempts || []) {
        const audioKey = await restore(a.__audioFile);
        if (!audioKey) continue;
        attempts.push({ ...a, audioKey, sessionId: id, peaks: a.peaks || [] });
      }
      const session: Session = {
        ...src,
        id,
        materialId: mat.id,
        attempts,
        markers: (src.markers || []).map((m: any) => ({ ...m, sessionId: id })),
        segments: src.segments || [],
        params: src.params || {},
      };
      await db.putSession(session);
      result.sessions++;
    } catch (e: any) {
      result.skipped++;
      warnings.push(`记录导入失败：${e?.message || e}`);
    }
  }

  onProgress?.(94, '导入术语库');
  for (const lib of raw.libs || []) {
    await db.putLib({ ...lib, id: lib.id || db.uid() });
  }
  const libIds = new Set((raw.libs || []).map((l: any) => l.id));
  for (const t of raw.terms || []) {
    const libId = libIds.has(t.libId) ? t.libId : (raw.libs?.[0]?.id ?? '');
    if (!libId) continue;
    await db.putTerm({ ...t, id: db.uid(), libId });
    result.terms++;
  }
  for (const v of raw.vocab || []) await db.putVocab({ ...v, id: db.uid() });
  if (!(await db.getPlan()).length && Array.isArray(raw.plan)) await db.putPlan(raw.plan);

  onProgress?.(100, '完成');
  return result;
}

/* ------------------------------------------------------------------ */
/* 本地文件夹批量导入                                                  */
/* ------------------------------------------------------------------ */

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac|opus|wma)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;

const baseName = (name: string) => {
  const n = name.split('/').pop() || name;
  return n.replace(/\.[^.]+$/, '').toLowerCase().trim();
};
const isAudio = (name: string) => AUDIO_EXT.test(name);
const isVideo = (name: string) => VIDEO_EXT.test(name);

export interface FolderPair {
  media: File;
  docs: File[];
  title: string;
}

/** 把文件夹里的文件按「同名」配成 媒体 + 稿件 的条目 */
export function pairFolderFiles(files: File[]): { pairs: FolderPair[]; orphans: File[] } {
  const mediaFiles = files.filter((f) => isAudio(f.name) || isVideo(f.name));
  const docFiles = files.filter((f) => isSlideDoc(f.name) || isScriptDoc(f.name));
  const byName = new Map<string, File[]>();
  for (const d of docFiles) {
    const k = baseName(d.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(d);
  }
  const used = new Set<File>();
  const pairs: FolderPair[] = mediaFiles.map((media) => {
    const k = baseName(media.name);
    const docs = (byName.get(k) || []).filter((d) => !used.has(d));
    docs.forEach((d) => used.add(d));
    return { media, docs, title: media.name.replace(/\.[^.]+$/, '') };
  });
  const orphans = docFiles.filter((d) => !used.has(d));
  return { pairs, orphans };
}

/** 导入「素材 + 同名稿件」的文件夹结构 */
export async function importFolder(
  files: File[],
  onProgress?: Progress,
): Promise<ImportResult & { orphanDocs: string[] }> {
  const { pairs, orphans } = pairFolderFiles(files);
  const result: ImportResult = { materials: 0, sessions: 0, terms: 0, skipped: 0, warnings: [] };

  for (let i = 0; i < pairs.length; i++) {
    const { media, docs, title } = pairs[i];
    onProgress?.(Math.round((i / Math.max(1, pairs.length)) * 100), `处理 ${media.name}`);
    try {
      const audioKey = await db.putAudio(media);
      const blob = await db.getAudio(audioKey);
      let duration = 0;
      let peaks: number[] = [];
      let sampleRate = 48000;
      let noWaveform = false;
      let trim = { start: 0, end: 0 };
      try {
        const decoded = await decodeFile(media);
        duration = decoded.duration;
        sampleRate = decoded.sampleRate;
        peaks = computePeaks(decoded.buffer);
        trim = detectSilenceEdges(decoded.buffer);
      } catch {
        duration = blob ? await probeMediaDuration(blob) : 0;
        noWaveform = true;
        trim = { start: 0, end: duration };
        if (!duration) throw new Error('无法读取媒体时长');
      }

      const material: Material = {
        id: db.uid(),
        title,
        createdAt: Date.now(),
        audioKey,
        kind: isVideo(media.name) ? 'video' : 'audio',
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

      // 稿件：幻灯片优先，其次文字稿
      let attached = false;
      for (const d of docs) {
        try {
          const doc = await parseScriptFile(d);
          if (doc.kind === 'slides' && doc.slides?.length) {
            material.slides = doc.slides;
            material.slidesSource = doc.source;
            material.slidesFile = d.name;
            material.docKind = 'slides';
            attached = true;
          } else {
            const patch = await buildScriptPatch(material, doc, d.name);
            Object.assign(material, patch);
            attached = true;
          }
        } catch (e: any) {
          result.warnings.push(`${d.name} 解析失败：${e?.message || e}`);
        }
      }
      await db.putMaterial(material);
      result.materials++;
      if (!attached && docs.length) result.warnings.push(`${title} 的稿件未能解析`);
    } catch (e: any) {
      result.skipped++;
      result.warnings.push(`${media.name} 导入失败：${e?.message || e}`);
    }
  }

  onProgress?.(100, '完成');
  return { ...result, orphanDocs: orphans.map((o) => o.name) };
}
