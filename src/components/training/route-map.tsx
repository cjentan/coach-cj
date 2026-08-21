"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import L from "leaflet";
import { RoutePoint } from "@/lib/trackpoint-charts";

// ─── Route Map (Leaflet + OpenStreetMap) ─────────────────────
//
// Loaded via next/dynamic(..., { ssr: false }) — Leaflet references `window`
// at module-evaluation time, so it must stay out of the server bundle.

function MapContent({ points, expanded }: { points: RoutePoint[]; expanded: boolean }) {
  const t = useTranslations("activities.detail");
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || points.length < 3) return;
    if (mapInstance.current) return; // already initialized

    const map = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: true,
    });

    // OpenStreetMap tiles — completely free, no API key required
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    // Draw route polyline
    const latlngs = points.map((p) => [p.lat, p.lon] as [number, number]);
    const polyline = L.polyline(latlngs, {
      color: "hsl(221.2, 83.2%, 53.3%)",
      weight: 3.5,
      opacity: 0.85,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);

    // Start marker (green circle)
    const start = latlngs[0];
    L.circleMarker(start, {
      radius: 7,
      fillColor: "#22c55e",
      color: "#ffffff",
      weight: 2,
      opacity: 1,
      fillOpacity: 1,
    })
      .addTo(map)
      .bindTooltip(t("start"), { permanent: false, direction: "top" });

    // End marker (red circle)
    const end = latlngs[latlngs.length - 1];
    L.circleMarker(end, {
      radius: 7,
      fillColor: "#ef4444",
      color: "#ffffff",
      weight: 2,
      opacity: 1,
      fillOpacity: 1,
    })
      .addTo(map)
      .bindTooltip(t("finish"), { permanent: false, direction: "top" });

    // Fit map to route bounds with padding
    map.fitBounds(polyline.getBounds(), { padding: [30, 30], maxZoom: 16 });

    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, [points, t]);

  // Invalidate size when entering/leaving expanded mode
  useEffect(() => {
    if (mapInstance.current) {
      // Small delay to let the DOM settle
      const timer = setTimeout(() => mapInstance.current!.invalidateSize(), 100);
      return () => clearTimeout(timer);
    }
  }, [expanded]);

  return (
    <div
      ref={mapRef}
      className="w-full rounded z-0"
      style={{ height: expanded ? "100%" : "16rem" }}
    />
  );
}

export function RouteMap({ points }: { points: RoutePoint[] }) {
  const t = useTranslations("activities.detail");
  const trainingT = useTranslations("training");
  const [expanded, setExpanded] = useState(false);

  if (points.length < 3) return null;

  return (
    <>
      {/* Normal card view */}
      <div className="rounded-lg border bg-muted/20 p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-medium text-muted-foreground">{trainingT("route")}</h3>
          <button
            onClick={() => setExpanded(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            title={trainingT("expandMap")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
            {t("expand")}
          </button>
        </div>
        <MapContent points={points} expanded={false} />
        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 border border-white" />{" "}
            {t("start")}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 border border-white" />{" "}
            {t("finish")}
          </span>
          <span className="ml-auto">© OpenStreetMap contributors</span>
        </div>
      </div>

      {/* Expanded overlay */}
      {expanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-[95vw] h-[90vh] rounded-xl border bg-background shadow-2xl overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30 shrink-0">
              <h3 className="text-sm font-semibold">{trainingT("routeMap")}</h3>
              <button
                onClick={() => setExpanded(false)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
                {t("close")}
              </button>
            </div>
            {/* Map */}
            <div className="flex-1 min-h-0">
              <MapContent points={points} expanded={true} />
            </div>
            {/* Footer */}
            <div className="flex items-center gap-3 px-4 py-1.5 border-t bg-muted/20 text-[10px] text-muted-foreground shrink-0">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 border border-white" />{" "}
                {t("start")}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 border border-white" />{" "}
                {t("finish")}
              </span>
              <span className="ml-auto">© OpenStreetMap contributors</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
