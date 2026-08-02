"use client";

import { useTranslations } from "next-intl";
import { Split, formatSplitPace, formatTime, LapSummary } from "@/lib/trackpoint-charts";

// ─── Splits Table ────────────────────────────────────────────

export function SplitsTable({ splits, type }: { splits: Split[]; type?: string }) {
  const t = useTranslations("activities.detail");
  if (splits.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 text-left">
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground w-12">#</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">{t("split")}</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">{t("cumTime")}</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">{type === "ride" ? "Speed" : t("pace")}</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">HR</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">{t("gain")}</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">{t("loss")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {splits.map((s) => (
            <tr key={s.km} className="hover:bg-muted/30 tabular-nums">
              <td className="px-3 py-1.5 text-muted-foreground">{s.km}</td>
              <td className="px-3 py-1.5 font-medium">{formatTime(s.splitSec)}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{formatTime(s.timeSec)}</td>
              <td className="px-3 py-1.5">{formatSplitPace(s.pace, type)}</td>
              <td className="px-3 py-1.5">{s.avgHr ? `${s.avgHr} bpm` : "—"}</td>
              <td className="px-3 py-1.5">{s.gainM > 0 ? `${s.gainM}m` : "—"}</td>
              <td className="px-3 py-1.5">{s.lossM > 0 ? `${s.lossM}m` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Lap Table (TCX-style laps) ──────────────────────────────

export function LapTable({ laps, type }: { laps: LapSummary[]; type?: string }) {
  const t = useTranslations("activities.detail");
  if (!laps || laps.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 text-left">
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground w-12">{t("laps")}</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Time</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Distance</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">{type === "ride" ? "Speed" : t("pace")}</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Avg HR</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Max HR</th>
            {laps.some((l) => l.avgPower) && (
              <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Power</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y">
          {laps.map((lap) => (
            <tr key={lap.index} className="hover:bg-muted/30 tabular-nums">
              <td className="px-3 py-1.5 text-muted-foreground">{lap.index}</td>
              <td className="px-3 py-1.5 font-medium">{formatTime(lap.durationSec)}</td>
              <td className="px-3 py-1.5">{type === "swim" ? `${Math.round(lap.distanceM)} m` : `${(lap.distanceM / 1000).toFixed(2)} km`}</td>
              <td className="px-3 py-1.5">{formatSplitPace(lap.pace, type)}</td>
              <td className="px-3 py-1.5">{lap.avgHr ? `${lap.avgHr} bpm` : "—"}</td>
              <td className="px-3 py-1.5">{lap.maxHr ? `${lap.maxHr} bpm` : "—"}</td>
              {laps.some((l) => l.avgPower) && (
                <td className="px-3 py-1.5">{lap.avgPower ? `${lap.avgPower}W` : "—"}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
