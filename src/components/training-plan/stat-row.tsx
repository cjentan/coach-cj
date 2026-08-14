"use client";

/**
 * Shared stat row component for planned vs actual metrics.
 * Used by PeriodSummary to avoid duplicating
 * the same render logic and progress bar styling.
 */

interface StatRowProps {
  icon: React.ReactNode;
  label: string;
  planned: string;
  actual: string;
  fraction: number;
}

export function StatRow({ icon, label, planned, actual, fraction }: StatRowProps) {
  const pct = Math.min(Math.round(fraction * 100), 100);
  const barColor =
    pct >= 90 ? "bg-green-500" : pct >= 70 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="min-w-0">
      <p className="text-[0.625rem] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
        {icon}
        {label}
      </p>
      <div className="flex items-baseline gap-1.5 text-xs">
        <span className="text-muted-foreground">P:</span>
        <span className="font-medium">{planned}</span>
      </div>
      <div className="flex items-baseline gap-1.5 text-xs mb-1.5">
        <span className="text-muted-foreground">A:</span>
        <span className="font-medium">{actual}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[0.625rem] text-muted-foreground mt-0.5">{pct}%</p>
    </div>
  );
}
