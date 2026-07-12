"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import { Split, formatSplitPace, formatTime } from "@/lib/trackpoint-charts";
import { LapSummary } from "@/lib/trackpoint-charts";
import { RoutePoint } from "@/lib/trackpoint-charts";

// ─── Splits Table ────────────────────────────────────────────

export function SplitsTable({ splits, paceUnit }: { splits: Split[]; paceUnit?: string }) {
  if (splits.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 text-left">
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground w-12">#</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Split</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Cum. Time</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Pace</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">HR</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Gain</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {splits.map((s) => (
            <tr key={s.km} className="hover:bg-muted/30 tabular-nums">
              <td className="px-3 py-1.5 text-muted-foreground">{s.km}</td>
              <td className="px-3 py-1.5 font-medium">{formatTime(s.splitSec)}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{formatTime(s.timeSec)}</td>
              <td className="px-3 py-1.5">{formatSplitPace(s.pace)}</td>
              <td className="px-3 py-1.5">{s.avgHr ? `${s.avgHr} bpm` : "—"}</td>
              <td className="px-3 py-1.5">{s.gainM > 0 ? `${s.gainM}m` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Lap Table (TCX-style laps) ──────────────────────────────

export function LapTable({ laps }: { laps: LapSummary[] }) {
  if (!laps || laps.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 text-left">
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground w-12">Lap</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Time</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Distance</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Pace</th>
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
              <td className="px-3 py-1.5">{(lap.distanceM / 1000).toFixed(2)} km</td>
              <td className="px-3 py-1.5">{formatSplitPace(lap.pace)}</td>
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

// ─── Route Map (Leaflet + OpenStreetMap) ─────────────────────

export function RouteMap({ points }: { points: RoutePoint[] }) {
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
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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
      .bindTooltip("Start", { permanent: false, direction: "top" });

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
      .bindTooltip("Finish", { permanent: false, direction: "top" });

    // Fit map to route bounds with padding
    map.fitBounds(polyline.getBounds(), { padding: [30, 30], maxZoom: 16 });

    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, [points]);

  if (points.length < 3) return null;

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <h3 className="text-xs font-medium text-muted-foreground mb-2">Route</h3>
      <div ref={mapRef} className="w-full h-64 rounded z-0" />
      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 border border-white" /> Start</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 border border-white" /> Finish</span>
        <span className="ml-auto">© OpenStreetMap contributors</span>
      </div>
    </div>
  );
}
