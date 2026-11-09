import { Gauge } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** 全站统一的播放倍速档位 */
export const RATE_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75] as const;

interface Props {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  /** 紧凑模式：用于工具条，尺寸更小 */
  compact?: boolean;
}

/**
 * 倍速选择器。
 * 触发器按最长档位（1.75×）预留宽度，选项里不再放括号长文案，
 * 避免文字撑破控件；「原速」改为右侧小字标注。
 */
export function RateSelect({ value, onChange, className, compact }: Props) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger
        className={cn(
          'gap-1.5 tabular-nums',
          compact ? 'h-7 w-[92px] px-2 text-xs' : 'h-9 w-[104px] text-sm',
          className,
        )}
      >
        <Gauge className={cn('shrink-0 opacity-60', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
        {/* 只显示倍速数值，避免下拉里的「原速」小字挤进触发器 */}
        <SelectValue>{`${value}×`}</SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-[124px]">
        {RATE_OPTIONS.map((r) => (
          <SelectItem key={r} value={String(r)} className="tabular-nums">
            <span className="flex w-full items-center justify-between gap-3">
              <span>{r}×</span>
              {r === 1 ? <span className="text-[10px] text-muted-foreground">原速</span> : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
