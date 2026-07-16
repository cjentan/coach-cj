"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import FilterControls, {
  type FilterValues,
} from "@/components/map/filter-controls";

const HeatmapMap = dynamic(
  () => import("@/components/map/heatmap-map"),
  { ssr: false },
);

interface MapBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export default function HeatmapPage() {
  const common = useTranslations("common");
  const t = useTranslations("heatmap");
  const { data: session, status } = useSession();
  const router = useRouter();

  const [totalCount, setTotalCount] = useState(0);
  const [needsBackfill, setNeedsBackfill] = useState(0);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  const [filters, setFilters] = useState<FilterValues>({
    type: "all",
    dateFrom: "",
    dateTo: "",
  });

  // Tile URL built from current filters
  const tileUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.type !== "all") params.set("type", filters.type);
    if (filters.dateFrom) params.set("from", filters.dateFrom);
    if (filters.dateTo) params.set("to", filters.dateTo);
    const qs = params.toString();
    return `/api/map/tiles/{z}/{x}/{y}.png${qs ? `?${qs}` : ""}`;
  }, [filters.type, filters.dateFrom, filters.dateTo]);

  // Hover query from current filters
  const hoverQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.type !== "all") params.set("type", filters.type);
    if (filters.dateFrom) params.set("from", filters.dateFrom);
    if (filters.dateTo) params.set("to", filters.dateTo);
    return params.toString();
  }, [filters.type, filters.dateFrom, filters.dateTo]);

  // Fetch metadata
  const fetchData = useCallback(async (f: FilterValues) => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (f.type !== "all") params.set("type", f.type);
    if (f.dateFrom) params.set("from", f.dateFrom);
    if (f.dateTo) params.set("to", f.dateTo);

    try {
      const res = await fetch(`/api/map/heatmap?${params}`);
      if (!res.ok) {
        if (res.status === 401) return router.push("/auth/signin");
        throw new Error("Failed to load heatmap data");
      }
      const data = await res.json();
      setTotalCount(data.totalCount || 0);
      setNeedsBackfill(data.needsBackfill || 0);
      setBounds(data.bounds || null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong",
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  // Build heatmap handler — processes all unprocessed GPS activities
  const handleBuildHeatmap = useCallback(async () => {
    setBuilding(true);
    setError(null);

    try {
      const res = await fetch("/api/map/heatmap/backfill", { method: "POST" });
      if (!res.ok) throw new Error("Failed to build heatmap");
      const result = await res.json();
      console.log(`[heatmap] Built: ${result.processed} processed, ${result.skipped} skipped`);

      // Re-fetch metadata to refresh counts and bounds
      await fetchData(filters);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to build heatmap",
      );
    } finally {
      setBuilding(false);
    }
  }, [filters, fetchData]);

  // Auth redirect
  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
  }, [status, router]);

  // Fetch metadata on auth + filter change
  useEffect(() => {
    if (status === "authenticated") fetchData(filters);
  }, [status, filters, fetchData]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-3.5rem)] text-muted-foreground">
        {common("loading")}
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  return (
    <div className="h-[calc(100vh-3.5rem)] w-full relative">
      {error && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1001] rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive backdrop-blur-sm">
          {error}
        </div>
      )}

      <FilterControls
        filters={filters}
        onChange={setFilters}
        activityCount={totalCount}
        needsBackfill={needsBackfill}
        building={building}
        onBuildHeatmap={handleBuildHeatmap}
        loading={loading}
      />

      {totalCount > 0 && (
        <HeatmapMap
          tileUrl={tileUrl}
          bounds={bounds}
          hoverQuery={hoverQuery}
        />
      )}
    </div>
  );
}
