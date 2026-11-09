import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const KEY = 'interplab:theme';

/** 读取偏好：显式选择优先，否则跟随系统 */
export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* 隐私模式下 localStorage 不可用，跟随系统即可 */
  }
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/** 把主题写到 <html>：全局所有页面（含训练页）共用同一套 token */
export function paint(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b1120' : '#ffffff');
}

/** 首屏渲染前调用，避免浅色内容先闪一下再变深色 */
export function initTheme(): Theme {
  const t = readTheme();
  paint(t);
  return t;
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: typeof window === 'undefined' ? 'light' : readTheme(),
  setTheme(t) {
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* 存不下也不影响本次会话 */
    }
    paint(t);
    set({ theme: t });
  },
  toggle() {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
  },
}));
