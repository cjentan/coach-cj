"use client";

import { useEffect, useRef, useCallback } from "react";
import L from "leaflet";

interface MapBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface HoverHit {
  id: string;
  name: string;
  type: string;
  startDate: string;
  distanceMeters: number | null;
}

interface HeatmapMapProps {
  /** Tile URL template with query params, e.g. "/api/map/tiles/{z}/{x}/{y}.png?type=run" */
  tileUrl: string;
  /** Aggregate bounds of all matching activities (for initial fit). */
  bounds: MapBounds | null;
  /** Query string for hover endpoint: "type=run&from=2024-01-01" */
  hoverQuery: string;
}

const TYPE_COLORS: Record<string, string> = {
  run: "#3b82f6",
  ride: "#f59e0b",
  swim: "#06b6d4",
  hike: "#22c55e",
  workout: "#a855f7",
  other: "#6b7280",
};

/**
 * Full-viewport Leaflet map displaying server-rendered heatmap tiles.
 *
 * All route rendering happens on the server via /api/map/tiles/{z}/{x}/{y}.png.
 * The client only loads a tile layer (standard PNG images) for maximum
 * performance, even with thousands of activities.
 *
 * Hover interaction: mousemove events are debounced and sent to
 * POST /api/map/hover for server-side hit-testing. Matching activities
 * are shown in a floating tooltip.
 */
export default function HeatmapMap({
  tileUrl,
  bounds,
  hoverQuery,
}: HeatmapMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoverDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFetchRef = useRef<string>(""); // avoid duplicate hover fetches

  // ── Mount: create map ───────────────────────────────────
  useEffect(() => {
    if (mapInstanceRef.current || !mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: true,
      center: [20, 0],
      zoom: 2,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      tileLayerRef.current = null;
    };
  }, []);

  // ── Tile layer: replace when URL changes ────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !tileUrl) return;

    // Remove old tile layer
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const newLayer = L.tileLayer(tileUrl, {
      maxZoom: 19,
      opacity: 1,
    }).addTo(map);

    tileLayerRef.current = newLayer;
  }, [tileUrl]);

  // ── Fit bounds when data loads ──────────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !bounds) return;

    const leafletBounds = L.latLngBounds(
      [bounds.minLat, bounds.minLng],
      [bounds.maxLat, bounds.maxLng],
    );

    if (leafletBounds.isValid()) {
      map.fitBounds(leafletBounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [bounds]);

  // ── Hover handler ───────────────────────────────────────
  const doHover = useCallback(
    async (lat: number, lng: number) => {
      const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
      if (key === lastFetchRef.current) return;
      lastFetchRef.current = key;

      try {
        const res = await fetch("/api/map/hover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat,
            lng,
            ...(hoverQuery ? Object.fromEntries(new URLSearchParams(hoverQuery)) : {}),
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        const activities: HoverHit[] = data.activities || [];
        showTooltip(activities);
      } catch {
        // ignore network errors
      }
    },
    [hoverQuery],
  );

  const showTooltip = useCallback((activities: HoverHit[]) => {
    const el = tooltipRef.current;
    if (!el) return;

    if (activities.length === 0) {
      el.style.display = "none";
      return;
    }

    el.innerHTML = activities
      .slice(0, 5)
      .map(
        (a) =>
          `<div class="flex items-center gap-1.5">
            <span class="inline-block w-2 h-2 rounded-full shrink-0" style="background:${TYPE_COLORS[a.type] || TYPE_COLORS.other}"></span>
            <span class="font-medium">${escHtml(a.name)}</span>
            <span class="text-[10px] text-muted-foreground">${formatDate(a.startDate)}</span>
          </div>`,
      )
      .join("");
    if (activities.length > 5) {
      el.innerHTML += `<div class="text-[10px] text-muted-foreground pt-0.5">+ ${activities.length - 5} more</div>`;
    }
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.gap = "2px";
  }, []);

  // Debounced mousemove
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (hoverDebounceRef.current) clearTimeout(hoverDebounceRef.current);
      hoverDebounceRef.current = setTimeout(() => {
        doHover(e.latlng.lat, e.latlng.lng);
      }, 150);
    };

    const onMouseOut = () => {
      if (hoverDebounceRef.current) clearTimeout(hoverDebounceRef.current);
      const el = tooltipRef.current;
      if (el) el.style.display = "none";
    };

    map.on("mousemove", onMouseMove);
    map.on("mouseout", onMouseOut);

    return () => {
      map.off("mousemove", onMouseMove);
      map.off("mouseout", onMouseOut);
      if (hoverDebounceRef.current) clearTimeout(hoverDebounceRef.current);
    };
  }, [doHover]);

  return (
    <div className="absolute inset-0 z-0">
      <div ref={mapContainerRef} className="absolute inset-0" />

      {/* Floating tooltip */}
      <div
        ref={tooltipRef}
        className="pointer-events-none fixed z-[2000] hidden gap-1 rounded-md border bg-background/90 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur-sm"
      />
    </div>
  );
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
