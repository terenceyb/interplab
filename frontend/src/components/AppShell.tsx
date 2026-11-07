import { NavLink, useLocation } from 'react-router-dom';
import {
  AudioLines,
  BookMarked,
  FolderOpen,
  LayoutDashboard,
  ListChecks,
  Mic,
  Settings,
  TrendingUp,
  FileDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '@/store/useApp';

const NAV = [
  { to: '/', label: '工作台', icon: LayoutDashboard, end: true },
  { to: '/library', label: '素材库', icon: FolderOpen },
  { to: '/glossary', label: '术语库', icon: BookMarked },
  { to: '/review', label: '训练记录', icon: ListChecks },
  { to: '/growth', label: '个人成长', icon: TrendingUp },
  { to: '/export', label: '记录导出', icon: FileDown },
  { to: '/settings', label: '数据与设置', icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const profile = useApp((s) => s.profile);
  const ready = useApp((s) => s.ready);

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r bg-background">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <AudioLines className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-none">InterpLab</div>
            <div className="mt-1 text-[11px] text-muted-foreground">口译自学训练工作台</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent',
                )
              }
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {profile.name.slice(0, 1)}
            </div>
            <div className="text-xs">
              <div className="font-medium">{profile.name}</div>
              <div className="text-muted-foreground">纯本地存储 · 仅本人可见</div>
            </div>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {!ready ? (
          <div className="flex h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
            <Mic className="h-4 w-4 animate-pulse" /> 正在载入本地数据…
          </div>
        ) : (
          <div key={loc.pathname} className="animate-in fade-in duration-200">
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
