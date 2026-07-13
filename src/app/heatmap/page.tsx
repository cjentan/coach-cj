"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import FilterControls, {
  type FilterValues,
} from "@/components/map/filter-controls";
import type { HeatmapActivity } from "@/components/map/heatmap-map";

const HeatmapMap = dynamic(
  () => import("@/components/map/heatmap-map"),
  { ssr: false }
);

interface MapBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export default function HeatmapPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [activities, setActivities] = useState<HeatmapActivity[]>([]);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterValues>({
    type: "all",
    dateFrom: "",
    dateTo: "",
    showHeatmap: true,
    showRoutes: false,
  });

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
      setActivities(data.activities || []);
      setBounds(data.bounds || null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong"
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  // Auth redirect
  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
  }, [status, router]);

  // Fetch data on auth + filter change
  useEffect(() => {
    if (status === "authenticated") fetchData(filters);
  }, [status, filters, fetchData]);

  // Auth check — don't render until we know the session state
  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-3.5rem)] text-muted-foreground">
        Loading…
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
        activityCount={activities.length}
        loading={loading}
      />

      <HeatmapMap
        activities={activities}
        bounds={bounds}
        showHeatmap={filters.showHeatmap}
        showRoutes={filters.showRoutes}
      />
    </div>
  );
}
