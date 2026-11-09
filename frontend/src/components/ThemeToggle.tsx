import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/store/useTheme';

/**
 * 全局浅色 / 深色切换。
 * 主界面放在侧栏底部（跟「我」的资料同一区域），训练页放在顶栏，
 * 两处共用一个主题状态，切换后所有页面同时生效。
 */
export function ThemeToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  const item = (value: 'light' | 'dark', icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setTheme(value)}
      aria-pressed={theme === value}
      title={label}
      className={cn(
        'flex items-center justify-center gap-1 rounded-md transition-colors',
        compact ? 'h-6 w-6' : 'h-6 flex-1 px-1.5 text-[11px]',
        theme === value
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {compact ? null : <span>{label}</span>}
    </button>
  );

  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border bg-muted/60 p-0.5',
        className,
      )}
      role="group"
      aria-label="配色模式"
    >
      {item('light', <Sun className="h-3.5 w-3.5" />, '浅色')}
      {item('dark', <Moon className="h-3.5 w-3.5" />, '深色')}
    </div>
  );
}
