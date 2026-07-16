"use client";

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

export interface FilterValues {
  type: string;
  dateFrom: string;
  dateTo: string;
}

interface FilterControlsProps {
  filters: FilterValues;
  onChange: (filters: FilterValues) => void;
  activityCount: number;
  needsBackfill: number;
  building: boolean;
  onBuildHeatmap: () => void;
  loading: boolean;
}

const ACTIVITY_TYPES = [
  { value: "all", label: "All Types" },
  { value: "run", label: "Run" },
  { value: "ride", label: "Ride" },
  { value: "swim", label: "Swim" },
  { value: "hike", label: "Hike" },
  { value: "workout", label: "Workout" },
  { value: "other", label: "Other" },
];

export default function FilterControls({
  filters,
  onChange,
  activityCount,
  needsBackfill,
  building,
  onBuildHeatmap,
  loading,
}: FilterControlsProps) {
  const t = useTranslations("map");
  const update = (patch: Partial<FilterValues>) =>
    onChange({ ...filters, ...patch });

  return (
    <div className="absolute top-3 left-3 right-3 md:left-3 md:right-auto md:w-80 z-[1000] bg-background/90 backdrop-blur-sm rounded-lg border shadow-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">{t("heatmap")}</h2>
          <span className="text-[10px] text-muted-foreground">
            {activityCount} activity
            {activityCount === 1 ? "" : "ies"}
          </span>
        </div>
        {loading && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Build heatmap prompt — shown when there are unprocessed activities */}
      {needsBackfill > 0 && (
        <div className="space-y-2 pt-1 border-t">
          <p className="text-xs text-muted-foreground">
            {needsBackfill} activity
            {needsBackfill === 1 ? " has" : "ies have"} GPS data that needs
            to be processed before the map can display it.
          </p>
          <button
            onClick={onBuildHeatmap}
            disabled={building}
            className="w-full rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {building ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Building heatmap…
              </span>
            ) : (
              t("build")
            )}
          </button>
          <p className="text-[10px] text-muted-foreground">
            This processes each activity once. After that the map loads instantly.
          </p>
        </div>
      )}

      {/* Filters — only show when heatmap is ready */}
      {activityCount > 0 && (
        <>
          {/* Activity type */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("activityType")}</Label>
            <Select
              value={filters.type}
              onValueChange={(v) => update({ type: v })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent className="z-[2000]">
                {ACTIVITY_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("from")}</Label>
              <Input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => update({ dateFrom: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("to")}</Label>
              <Input
                type="date"
                value={filters.dateTo}
                onChange={(e) => update({ dateTo: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Hover hint */}
          <p className="text-[10px] text-muted-foreground pt-1 border-t">
            Hover over any route to see which activities are there.
          </p>
        </>
      )}
    </div>
  );
}
