export type TrainMode = 'consecutive' | 'sim-text' | 'sim-noscript' | 'shadowing';

export const MODE_LABEL: Record<TrainMode, string> = {
  consecutive: '交替传译',
  'sim-text': '带稿同传',
  'sim-noscript': '无稿同传',
  shadowing: '影子练习',
};

/** 问题类型：忠实度 / 流利度 / 表达 / 策略 */
export type MarkerCategory = 'fidelity' | 'fluency' | 'expression' | 'strategy';

export interface MarkerTypeDef {
  key: string;
  label: string;
  category: MarkerCategory;
  /** 快捷键 1-4 对应的常用类型顺序 */
  hot?: number;
  color: string;
}

export const CATEGORY_LABEL: Record<MarkerCategory, string> = {
  fidelity: '忠实度',
  fluency: '流利度',
  expression: '表达',
  strategy: '策略',
};

export const MARKER_TYPES: MarkerTypeDef[] = [
  { key: 'omission', label: '漏译', category: 'fidelity', hot: 1, color: '#ef4444' },
  { key: 'mistranslation', label: '误译', category: 'fidelity', hot: 2, color: '#f97316' },
  { key: 'addition', label: '增译', category: 'fidelity', color: '#eab308' },
  { key: 'number-entity', label: '数字/专名错误', category: 'fidelity', color: '#a855f7' },
  { key: 'long-pause', label: '长时间停顿', category: 'fluency', hot: 3, color: '#3b82f6' },
  { key: 'filler', label: '填充词', category: 'fluency', color: '#06b6d4' },
  { key: 'self-repair', label: '自我修正', category: 'fluency', color: '#14b8a6' },
  { key: 'repetition', label: '重复', category: 'fluency', color: '#8b5cf6' },
  { key: 'grammar', label: '语法错误', category: 'expression', color: '#84cc16' },
  { key: 'wording', label: '用词不当', category: 'expression', color: '#f43f5e' },
  { key: 'pace', label: '语速失控', category: 'expression', color: '#fb7185' },
  { key: 'evs-short', label: 'EVS 过短', category: 'strategy', hot: 4, color: '#0ea5e9' },
  { key: 'evs-long', label: 'EVS 过长', category: 'strategy', color: '#6366f1' },
  { key: 'note-unused', label: '笔记未利用', category: 'strategy', color: '#94a3b8' },
];

export const MARKER_MAP = Object.fromEntries(MARKER_TYPES.map((m) => [m.key, m])) as Record<string, MarkerTypeDef>;

/** 素材 */
export interface Material {
  id: string;
  title: string;
  createdAt: number;
  audioKey: string; // IndexedDB 中的音频 blob key
  duration: number; // 秒
  sampleRate: number;
  peaks: number[]; // 归一化波形峰值
  trim: { start: number; end: number }; // 首尾裁剪（秒）
  tags: string[]; // 主题
  difficulty: 'easy' | 'medium' | 'hard';
  accent: string;
  speechRate: string; // 语速标签
  favorite: boolean;
  /** A-04 难度标注：估算语速与信息密度 */
  wpm?: number;
  density?: 1 | 2 | 3;
  /** 稿件 / 字幕文本（原始） */
  script?: string;
  /** 句子与音频时间的对齐锚点 */
  sentences: Sentence[];
  replayAt?: number; // 计划重练日期（时间戳）
}

export interface Sentence {
  id: string;
  index: number;
  text: string;
  start: number;
  end: number;
  confidence: number; // 0-1，低置信需手动校准
}

/** 分段（交传智能分段结果） */
export interface Segment {
  index: number;
  start: number;
  end: number;
  confidence: number; // 边界置信度 0-1
  approx: boolean; // 近似切分（超出浮动范围）
  text?: string;
  flag?: boolean; // 用户标记“待调整”
}

export interface SegmentParams {
  target: number; // 期望时长（秒）
  floatPct: number; // 浮动范围（0.1 / 0.2 / 0.3）
  minSeg: number;
  maxSeg: number;
  preference: 'balance' | 'punctuation' | 'pause';
}

/** 一次录音（一段交传 / 一整次同传 / 影子） */
export interface Attempt {
  id: string;
  sessionId: string;
  segmentIndex?: number; // 交传时的分段序号
  audioKey: string;
  duration: number;
  peaks: number[];
  /** 与源语共享时间基准：源语区间 */
  sourceStart: number;
  sourceEnd: number;
  userAudioStart: number;
  userAudioEnd: number;
  attemptNumber: number;
  createdAt: number;
  /** 数字笔记板笔迹 */
  strokes?: Stroke[];
  /** 用户自填译语转写（用于忠实度/覆盖率线索） */
  transcript?: string;
}

export interface Stroke {
  t: number; // 相对录音开始的时间（秒）
  pts: [number, number][]; // 归一化坐标
}

export interface Marker {
  id: string;
  sessionId: string;
  t: number; // 源语时间轴（秒）
  type: string; // MarkerTypeDef.key
  note?: string;
  createdAt: number;
}

/** 自动评估线索 */
export interface FluencyClues {
  pauseCount: number;
  avgPause: number; // 秒
  longestPause: { t: number; len: number } | null;
  phonationRatio: number; // 发声时间比 0-1
  wpm?: number; // 有转写时的语速
  longPausePositions: number[]; // 超过 1.5s 的停顿起点（源语时间轴）
}

export interface CoverageClues {
  available: boolean;
  reason?: string;
  entities: { text: string; hit: boolean }[];
  hitRate?: number;
}

export interface FidelityClues {
  available: boolean;
  reason?: string;
  tokenOverlap?: number; // 0-1 内容词重叠
  numberMatch?: { total: number; hit: number };
  riskySpans?: { start: number; end: number; reason: string }[];
}

export interface MetricsResult {
  fluency: FluencyClues;
  coverage: CoverageClues;
  fidelity: FidelityClues;
  computedAt: number;
}

export interface SessionParams {
  rate?: number;
  hideText?: boolean;
  maskMode?: 'none' | 'tail' | 'random';
  maskRatio?: number;
  evsTarget?: number;
  shadowLang?: 'source' | 'target';
  shadowType?: 'phoneme' | 'phrase';
  noise?: boolean;
  countdown?: number;
}

/** 训练记录 */
export interface Session {
  id: string;
  materialId: string;
  materialTitle: string;
  mode: TrainMode;
  createdAt: number;
  duration: number; // 源语有效训练时长（秒）
  attemptNumber: number; // 该素材该模式第几轮
  segments: Segment[];
  attempts: Attempt[];
  markers: Marker[];
  metrics?: MetricsResult;
  note?: string;
  params: SessionParams;
  /** 影子练习自报告 EVS 样本 */
  evsSamples?: { t: number; lag: number }[];
}

export interface GlossaryTerm {
  id: string;
  libId: string;
  term: string;
  translation: string;
  note?: string;
  mastered: boolean;
  createdAt: number;
}

export interface GlossaryLib {
  id: string;
  name: string;
  createdAt: number;
}

/** 生词本条目 */
export interface VocabItem {
  id: string;
  word: string;
  note?: string;
  from: string; // 来源
  createdAt: number;
}

export interface PlanGoal {
  id: string;
  mode: TrainMode | 'review';
  target: number; // 每周次数
  period: 'week' | 'month';
}

export interface Profile {
  name: string;
  createdAt: number;
  storageMode: 'local';
}

export interface ExportLog {
  id: string;
  at: number;
  kind: string;
  count: number;
}
