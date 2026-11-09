import type { MaterialLanguage } from '@/types';

export const LANGUAGES: { code: MaterialLanguage; label: string; short: string }[] = [
  { code: 'zh', label: '中文', short: '中' },
  { code: 'en', label: '英语', short: 'EN' },
  { code: 'ja', label: '日语', short: '日' },
  { code: 'ko', label: '韩语', short: '韩' },
  { code: 'fr', label: '法语', short: 'FR' },
  { code: 'de', label: '德语', short: 'DE' },
  { code: 'ru', label: '俄语', short: 'RU' },
  { code: 'es', label: '西班牙语', short: 'ES' },
  { code: 'ar', label: '阿拉伯语', short: 'AR' },
  { code: 'other', label: '其他', short: '…' },
];

const MAP = new Map(LANGUAGES.map((l) => [l.code, l]));

export const langLabel = (code?: MaterialLanguage | string) =>
  (code && MAP.get(code as MaterialLanguage)?.label) || '未标注';

export const langShort = (code?: MaterialLanguage | string) =>
  (code && MAP.get(code as MaterialLanguage)?.short) || '?';
