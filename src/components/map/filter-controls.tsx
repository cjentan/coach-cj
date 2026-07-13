"use client";

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
  showHeatmap: boolean;
  showRoutes: boolean;
}

interface FilterControlsProps {
  filters: FilterValues;
  onChange: (filters: FilterValues) => void;
  activityCount: number;
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
  loading,
}: FilterControlsProps) {
  const update = (patch: Partial<FilterValues>) =>
    onChange({ ...filters, ...patch });

  return (
    <div className="absolute top-3 left-3 right-3 md:left-3 md:right-auto md:w-80 z-[1000] bg-background/90 backdrop-blur-sm rounded-lg border shadow-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Heatmap</h2>
          <span className="text-[10px] text-muted-foreground">
            {activityCount} activity
            {activityCount === 1 ? "" : "ies"} loaded
          </span>
        </div>
        {loading && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Activity type */}
      <div className="space-y-1.5">
        <Label className="text-xs">Activity Type</Label>
        <Select
          value={filters.type}
          onValueChange={(v) => update({ type: v })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
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
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => update({ dateFrom: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">To</Label>
          <Input
            type="date"
            value={filters.dateTo}
            onChange={(e) => update({ dateTo: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
      </div>

      {/* Layer toggles */}
      <div className="flex gap-4 pt-1">
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filters.showHeatmap}
            onChange={(e) => update({ showHeatmap: e.target.checked })}
            className="accent-primary h-3.5 w-3.5"
          />
          Heatmap
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filters.showRoutes}
            onChange={(e) => update({ showRoutes: e.target.checked })}
            className="accent-primary h-3.5 w-3.5"
          />
          Routes
        </label>
      </div>

      {/* Empty state hint */}
      {!loading && activityCount === 0 && (
        <p className="text-xs text-muted-foreground pt-1 border-t">
          No GPS-tracked activities found.
          {filters.type !== "all" || filters.dateFrom || filters.dateTo
            ? " Try adjusting your filters."
            : " Import activities with GPX, FIT, or TCX files to see your heatmap."}
        </p>
      )}
    </div>
  );
}
