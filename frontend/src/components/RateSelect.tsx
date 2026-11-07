import { Gauge } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** 全局统一的播放倍速档位 */
export const RATE_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75] as const;

interface Props {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  /** 紧凑模式：只显示数字，用于工具条 */
  compact?: boolean;
}

export function RateSelect({ value, onChange, className, compact }: Props) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className={className ?? (compact ? 'h-7 w-[86px] text-xs' : 'w-[110px]')}>
        <span className="flex items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {RATE_OPTIONS.map((r) => (
          <SelectItem key={r} value={String(r)}>
            {r}×{r === 1 ? '（原速）' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
