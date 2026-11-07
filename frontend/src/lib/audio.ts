/**
 * 音频内核：解码、波形峰值、双轨播放器（变速不变调 / 同步 / 双耳分听）、麦克风录制
 * 时间基准约定：所有对外暴露的时间均为「素材虚拟时间轴」——即以 trim.start 为 0 的时间。
 */

export interface DecodedAudio {
  buffer: AudioBuffer;
  duration: number;
  sampleRate: number;
  peaks: number[];
  channels: number;
}

/** 供 hooks 层使用的轻量 VAD 结果类型占位（避免循环依赖） */
export type VoiceActivityLike = import('@/lib/vad').VoiceActivity;

let sharedCtx: AudioContext | null = null;
export function audioCtx(): AudioContext {
  if (!sharedCtx) sharedCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return sharedCtx;
}

export async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const ctx = audioCtx();
  const arr = await blob.arrayBuffer();
  return await ctx.decodeAudioData(arr);
}

/** 计算波形峰值（归一化 0-1），采样密度 40 桶/秒，上限 6000 */
export function computePeaks(buffer: AudioBuffer, density = 40, maxBuckets = 6000): number[] {
  const ch = buffer.getChannelData(0);
  const total = Math.min(Math.max(1, Math.floor(buffer.duration * density)), maxBuckets);
  const step = ch.length / total;
  const out: number[] = new Array(total);
  let max = 0;
  for (let i = 0; i < total; i++) {
    const s = Math.floor(i * step);
    const e = Math.min(ch.length, Math.floor((i + 1) * step));
    let peak = 0;
    // 长音频抽样扫描，避免 O(n) 卡顿
    const stride = Math.max(1, Math.floor((e - s) / 512));
    for (let j = s; j < e; j += stride) {
      const v = Math.abs(ch[j]);
      if (v > peak) peak = v;
    }
    out[i] = peak;
    if (peak > max) max = peak;
  }
  if (max > 0) for (let i = 0; i < total; i++) out[i] = out[i] / max;
  return out;
}

export async function decodeFile(blob: Blob): Promise<DecodedAudio> {
  const buffer = await decodeBlob(blob);
  return {
    buffer,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    peaks: computePeaks(buffer),
    channels: buffer.numberOfChannels,
  };
}

/** 首尾静音检测：返回建议裁剪区间（秒） */
export function detectSilenceEdges(buffer: AudioBuffer, thresh = 0.02): { start: number; end: number } {
  const ch = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const win = Math.floor(sr * 0.05);
  const frames = Math.floor(ch.length / win);
  const energy: number[] = [];
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let j = i * win; j < (i + 1) * win; j += 8) s += ch[j] * ch[j];
    energy.push(Math.sqrt(s / (win / 8)));
  }
  const sorted = [...energy].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] || 0;
  const t = Math.max(thresh * 0.5, floor * 3 + 0.005);
  let start = 0;
  let end = frames;
  for (let i = 0; i < frames; i++) {
    if (energy[i] > t) {
      start = i;
      break;
    }
  }
  for (let i = frames - 1; i >= 0; i--) {
    if (energy[i] > t) {
      end = i + 1;
      break;
    }
  }
  return {
    start: Math.max(0, (start * win) / sr - 0.15),
    end: Math.min(buffer.duration, (end * win) / sr + 0.15),
  };
}

/* ---------------- 双轨播放器 ---------------- */

export type PlayMode = 'source' | 'user' | 'mix' | 'split';

export interface DualPlayerOptions {
  srcUrl: string;
  /** 源语媒体类型：video 时使用 <video> 元素承载（音频仍走同一播放内核） */
  kind?: 'audio' | 'video';
  userUrl?: string;
  trimStart?: number;
  trimEnd?: number;
  /** 源语时间 -> 译语录音时间；返回 null 表示该点无录音 */
  mapToUser?: (srcT: number) => number | null;
  onTick?: (srcT: number) => void;
  onEnd?: () => void;
}

/** 按媒体类型创建承载元素：音频用 Audio，视频用 video（隐藏 DOM 时也能解码播放） */
function makeMediaEl(kind: 'audio' | 'video', url: string): HTMLMediaElement {
  const el = kind === 'video' ? document.createElement('video') : new Audio();
  if (kind === 'video') {
    const v = el as HTMLVideoElement;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.preload = 'auto';
  }
  el.src = url;
  el.preload = 'auto';
  el.preservesPitch = true;
  return el;
}

export class DualPlayer {
  src: HTMLMediaElement;
  usr: HTMLMediaElement | null = null;
  private playing = false;
  mode: PlayMode = 'source';
  rate = 1;
  swapEars = false;
  private trimStart = 0;
  private trimEnd = Infinity;
  private mapToUser?: (t: number) => number | null;
  private onTick?: (t: number) => void;
  private onEnd?: () => void;
  private raf = 0;
  private stopAt: number | null = null;
  private ctx: AudioContext | null = null;
  private graphOk = false;
  private gainSrc: GainNode | null = null;
  private gainUsr: GainNode | null = null;
  private srcNode: MediaElementAudioSourceNode | null = null;
  private usrNode: MediaElementAudioSourceNode | null = null;
  private panSrc: StereoPannerNode | null = null;
  private panUsr: StereoPannerNode | null = null;

  constructor(opts: DualPlayerOptions) {
    this.src = makeMediaEl(opts.kind ?? 'audio', opts.srcUrl);
    this.trimStart = opts.trimStart ?? 0;
    this.trimEnd = opts.trimEnd ?? Infinity;
    this.mapToUser = opts.mapToUser;
    this.onTick = opts.onTick;
    this.onEnd = opts.onEnd;
    if (opts.userUrl) {
      this.usr = new Audio(opts.userUrl);
      this.usr.preload = 'auto';
      this.usr.preservesPitch = true;
    }
    this.src.addEventListener('ended', () => this.handleEnd());
    this.usr?.addEventListener('ended', () => this.handleEnd());
  }

  /** 源语虚拟时长 */
  get duration(): number {
    const raw = Number.isFinite(this.src.duration) ? this.src.duration : 0;
    return Math.max(0, Math.min(raw, this.trimEnd) - this.trimStart);
  }

  /** 当前源语虚拟时间 */
  get time(): number {
    return this.src.currentTime - this.trimStart;
  }

  setUserUrl(url: string) {
    this.usr?.pause();
    // 换元素必须重建译语侧的源节点，否则新元素没有接入音频图（会完全无声）
    this.usrNode?.disconnect();
    this.usrNode = null;
    this.usr = makeMediaEl('audio', url);
    this.usr.playbackRate = this.rate;
    this.usr.addEventListener('ended', () => this.handleEnd());
    this.buildGraph();
  }

  /** Web Audio 图：源语/译语分别经 gain + panner 进入合并器，实现混合与双耳分听 */
  private buildGraph() {
    if (this.graphOk || !this.usr) return;
    try {
      const ctx = audioCtx();
      if (!this.srcNode) this.srcNode = ctx.createMediaElementSource(this.src);
      if (!this.usrNode) this.usrNode = ctx.createMediaElementSource(this.usr);
      const gS = ctx.createGain();
      const gU = ctx.createGain();
      const pS = ctx.createStereoPanner();
      const pU = ctx.createStereoPanner();
      // 两轨各自经 gain -> panner 直接进 destination：
      // mix 时两轨都居中（真正叠加），split 时分别硬左/硬右。
      this.srcNode.connect(gS).connect(pS).connect(ctx.destination);
      this.usrNode.connect(gU).connect(pU).connect(ctx.destination);
      this.ctx = ctx;
      this.gainSrc = gS;
      this.gainUsr = gU;
      this.panSrc = pS;
      this.panUsr = pU;
      this.graphOk = true;
      this.applyMode();
    } catch {
      this.graphOk = false;
    }
  }

  private applyMode() {
    const hasUser = !!this.usr;
    if (!this.graphOk) {
      this.src.muted = this.mode === 'user';
      this.src.volume = this.mode === 'mix' ? 0.6 : 1;
      if (this.usr) {
        this.usr.muted = this.mode === 'source' || !hasUser;
        this.usr.volume = this.mode === 'mix' ? 1 : 1;
      }
      return;
    }
    const gs = this.gainSrc!;
    const gu = this.gainUsr!;
    const ps = this.panSrc!;
    const pu = this.panUsr!;
    const dir = this.swapEars ? -1 : 1;
    switch (this.mode) {
      case 'source':
        gs.gain.value = 1;
        gu.gain.value = 0;
        ps.pan.value = 0;
        pu.pan.value = 0;
        break;
      case 'user':
        gs.gain.value = 0;
        gu.gain.value = 1;
        ps.pan.value = 0;
        pu.pan.value = 0;
        break;
      case 'mix':
        gs.gain.value = 0.5;
        gu.gain.value = 0.9;
        ps.pan.value = 0;
        pu.pan.value = 0;
        break;
      case 'split':
        gs.gain.value = 1;
        gu.gain.value = 1;
        ps.pan.value = -1 * dir;
        pu.pan.value = 1 * dir;
        break;
    }
  }

  setMode(m: PlayMode) {
    this.mode = m;
    this.applyMode();
  }

  setSwap(v: boolean) {
    this.swapEars = v;
    this.applyMode();
  }

  setRate(r: number) {
    this.rate = Math.min(2, Math.max(0.25, r));
    for (const el of [this.src, this.usr]) {
      if (!el) continue;
      el.preservesPitch = true;
      el.playbackRate = this.rate;
    }
  }

  async play(from?: number, stopAt?: number | null) {
    this.buildGraph();
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
    if (from !== undefined) this.seek(from);
    this.stopAt = stopAt ?? null;
    this.playing = true;
    if (this.mode !== 'user') await this.src.play();
    // 关键修复：mix / split 也必须启动译语轨，否则只能听到源语
    if (this.mode !== 'source' && this.usr) {
      this.primeUser();
      await this.usr.play().catch(() => undefined);
    }
    this.startTicking();
  }

  pause() {
    this.playing = false;
    this.src.pause();
    this.usr?.pause();
    cancelAnimationFrame(this.raf);
  }

  stop() {
    this.pause();
    this.seek(0);
  }

  seek(t: number) {
    const clamped = Math.max(0, Math.min(t, this.duration));
    this.src.currentTime = clamped + this.trimStart;
    this.syncUser(true);
    this.onTick?.(clamped);
  }

  /** 播放前把译语轨定位到与源语当前时刻对应的位置 */
  private primeUser() {
    if (!this.usr || !this.mapToUser) return;
    const ut = this.mapToUser(this.time);
    if (ut == null) return;
    try {
      this.usr.currentTime = Math.max(0, ut);
    } catch {
      /* ignore */
    }
  }

  /**
   * 将译语轨对齐到源语轨当前位置。
   * 源语时间落在录音区间之外（译语尚未开始 / 已结束）时暂停译语轨，
   * 进入区间后再自动续播，避免两轨错位。
   */
  private syncUser(force = false) {
    if (!this.usr || !this.mapToUser) return;
    if (this.mode === 'source') return;
    const ut = this.mapToUser(this.time);
    if (ut == null) {
      if (!this.usr.paused) this.usr.pause();
      return;
    }
    if (this.usr.paused && this.playing) {
      void this.usr.play().catch(() => undefined);
    }
    if (force || Math.abs(this.usr.currentTime - ut) > 0.15) {
      try {
        this.usr.currentTime = Math.max(0, ut);
      } catch {
        /* ignore */
      }
    }
  }

  private startTicking() {
    cancelAnimationFrame(this.raf);
    const loop = () => {
      const t = this.time;
      this.onTick?.(t);
      if (this.mode !== 'source' && this.mode !== 'user') this.syncUser();
      if (this.stopAt != null && t >= this.stopAt) {
        this.pause();
        this.stopAt = null;
        this.onEnd?.();
        return;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private handleEnd() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.onEnd?.();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.src.pause();
    this.usr?.pause();
    this.src.src = '';
    if (this.usr) this.usr.src = '';
  }
}

/* ---------------- 录音 ---------------- */

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

export class Recorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private chunks: BlobPart[] = [];
  private accum = 0;
  private segStart = 0;
  private paused = false;
  private raf = 0;
  running = false;
  startedAt = 0;
  mime = '';
  onLevel?: (rms: number, wave: number[]) => void;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    this.ctx = audioCtx();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    this.mime = pickMime();
    this.rec = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec.start(250);
    this.running = true;
    this.paused = false;
    this.accum = 0;
    this.segStart = performance.now();
    this.startedAt = this.segStart;
    this.tick();
  }

  private tick() {
    if (!this.analyser) return;
    const buf = new Uint8Array(this.analyser.fftSize);
    const loop = () => {
      if (!this.running) return;
      this.analyser!.getByteTimeDomainData(buf);
      let s = 0;
      const wave: number[] = [];
      const step = Math.floor(buf.length / 48);
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        s += v * v;
        if (i % step === 0) wave.push(v);
      }
      this.onLevel?.(Math.sqrt(s / buf.length), wave);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** 与源语同步暂停：译语轨同时暂停，恢复后两轨时间轴不漂移 */
  pause() {
    if (!this.running || this.paused) return;
    this.accum += performance.now() - this.segStart;
    this.paused = true;
    try {
      if (this.rec?.state === 'recording') this.rec.pause();
    } catch {
      /* ignore */
    }
  }

  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.segStart = performance.now();
    try {
      if (this.rec?.state === 'paused') this.rec.resume();
    } catch {
      /* ignore */
    }
  }

  get pausedState() {
    return this.paused;
  }

  /** 已录制的净时长（排除暂停） */
  get elapsed(): number {
    const live = this.running && !this.paused ? performance.now() - this.segStart : 0;
    return (this.accum + live) / 1000;
  }

  async stop(): Promise<{ blob: Blob; duration: number; peaks: number[] } | null> {
    if (!this.rec || !this.running) return null;
    this.running = false;
    cancelAnimationFrame(this.raf);
    const dur = this.elapsed;
    const done = new Promise<Blob>((resolve) => {
      this.rec!.onstop = () => resolve(new Blob(this.chunks, { type: this.mime || 'audio/webm' }));
    });
    this.rec.stop();
    const blob = await done;
    this.stream?.getTracks().forEach((t) => t.stop());
    let peaks: number[] = [];
    let duration = dur;
    try {
      const buf = await decodeBlob(blob);
      duration = buf.duration || dur;
      peaks = computePeaks(buf, 40, 4000);
    } catch {
      /* 编解码失败时用计时值兜底 */
    }
    return { blob, duration, peaks };
  }

  cancel() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    try {
      this.rec?.stop();
    } catch {
      /* ignore */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
  }
}

export const micAvailable = () =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof MediaRecorder !== 'undefined';

/** 生成 1 秒静音 WAV，用于录音权限自检或占位 */
export function makeSilentWav(seconds = 1, sampleRate = 16000): Blob {
  const len = seconds * sampleRate;
  const buf = new ArrayBuffer(44 + len * 2);
  const view = new DataView(buf);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + len * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, len * 2, true);
  return new Blob([buf], { type: 'audio/wav' });
}
