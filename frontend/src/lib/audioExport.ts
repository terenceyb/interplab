import { decodeBlob } from './audio';
import { getAudio } from './db';

const TARGET_SR = 44100;
const BITRATE = 128; // kbps，语音足够，体积适中

/* ------------------------------------------------------------------ */
/* 文件名                                                              */
/* ------------------------------------------------------------------ */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 去掉文件名中的非法字符（Windows/macOS/Linux 通用） */
export function sanitizeFileName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|\r\n\t]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[-.\s]+|[-.\s]+$/g, '')
    .slice(0, 120) || '未命名';
}

/**
 * 默认导出名：`YYYYMMDD-HHmm练习-素材标题.mp3`
 * 例：`20261109-1103练习-美国总统拜登演讲.mp3`
 */
export function defaultAudioName(materialTitle: string, when = Date.now()): string {
  const d = new Date(when);
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  return `${stamp}练习-${sanitizeFileName(materialTitle)}.mp3`;
}

/** 补齐扩展名：用户自定义时可能没写 */
export function ensureMp3Ext(name: string): string {
  const n = name.trim() || defaultAudioName('未命名');
  return /\.mp3$/i.test(n) ? n : `${n.replace(/\.[a-z0-9]{1,5}$/i, '')}.mp3`;
}

/* ------------------------------------------------------------------ */
/* 重采样与拼接                                                        */
/* ------------------------------------------------------------------ */

async function resample(buf: AudioBuffer, channels: number): Promise<AudioBuffer> {
  if (buf.sampleRate === TARGET_SR && buf.numberOfChannels === channels) return buf;
  const len = Math.max(1, Math.ceil(buf.duration * TARGET_SR));
  const off = new OfflineAudioContext(channels, len, TARGET_SR);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  return off.startRendering();
}

function bufferToFloatChannels(buf: AudioBuffer, channels: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    // 单声道源要上混到立体声时，两个声道都用同一份数据
    out.push(buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)).slice());
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* MP3 编码                                                            */
/* ------------------------------------------------------------------ */

export interface AudioExportItem {
  /** IndexedDB 中的录音 key */
  audioKey: string;
  /** 该段之后的静音间隔（秒），用于区分交传分段 */
  gapAfter?: number;
}

export interface AudioExportResult {
  blob: Blob;
  duration: number;
  segments: number;
}

/**
 * 把若干段录音合成为一个 MP3。
 * 交传会有多段录音，按顺序拼接，段间插入短静音（默认 0.4s）便于回听时分清段落。
 */
export async function buildMp3(
  items: AudioExportItem[],
  opts: { gap?: number; onProgress?: (p: number) => void } = {},
): Promise<AudioExportResult> {
  const gap = opts.gap ?? 0.4;
  const progress = opts.onProgress ?? (() => {});

  // 1) 逐个取出并解码
  const decoded: { buf: AudioBuffer; gapAfter: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const blob = await getAudio(items[i].audioKey);
    if (!blob) continue;
    try {
      const buf = await decodeBlob(blob);
      decoded.push({ buf, gapAfter: i === items.length - 1 ? 0 : (items[i].gapAfter ?? gap) });
    } catch {
      /* 单段解码失败跳过，不影响其他段 */
    }
    progress(((i + 1) / items.length) * 0.5);
  }
  if (!decoded.length) throw new Error('没有可导出的录音');

  // 2) 统一声道数
  const channels = Math.min(2, Math.max(1, ...decoded.map((d) => d.buf.numberOfChannels)));

  // 3) 重采样并拼接到统一缓冲区
  const gapSamples = Math.round(gap * TARGET_SR);
  const parts: Float32Array[][] = [];
  let totalSamples = 0;
  for (let i = 0; i < decoded.length; i++) {
    const res = await resample(decoded[i].buf, channels);
    const chs = bufferToFloatChannels(res, channels);
    parts.push(chs);
    totalSamples += res.length;
    if (i < decoded.length - 1) totalSamples += Math.round(decoded[i].gapAfter * TARGET_SR);
    progress(0.5 + ((i + 1) / decoded.length) * 0.2);
  }
  void gapSamples;

  const merged: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(totalSamples));
  let cursor = 0;
  for (let i = 0; i < parts.length; i++) {
    const chs = parts[i];
    for (let c = 0; c < channels; c++) merged[c].set(chs[c], cursor);
    cursor += chs[0].length;
    if (i < parts.length - 1) cursor += Math.round(decoded[i].gapAfter * TARGET_SR);
  }

  // 4) 转 Int16 并编码
  const int16: Int16Array[] = merged.map((arr) => {
    const o = new Int16Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      const s = Math.max(-1, Math.min(1, arr[i]));
      o[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return o;
  });

  // 按需加载编码器：MP3 编码只在导出时用到，不占首屏体积
  const lamejs = (await import('@breezystack/lamejs')).default;
  const enc = new lamejs.Mp3Encoder(channels, TARGET_SR, BITRATE);
  const chunks: Uint8Array[] = [];
  const block = 1152;
  const total = int16[0].length;
  for (let i = 0; i < total; i += block) {
    const l = int16[0].subarray(i, i + block);
    const buf = channels === 2 ? enc.encodeBuffer(l, int16[1].subarray(i, i + block)) : enc.encodeBuffer(l);
    if (buf.length) chunks.push(new Uint8Array(buf));
    if (i % (block * 200) === 0) progress(0.7 + (i / total) * 0.3);
  }
  const tail = enc.flush();
  if (tail.length) chunks.push(new Uint8Array(tail));
  progress(1);

  return {
    blob: new Blob(chunks as BlobPart[], { type: 'audio/mpeg' }),
    duration: totalSamples / TARGET_SR,
    segments: decoded.length,
  };
}
