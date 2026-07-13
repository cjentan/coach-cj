"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet.heat";

export interface HeatmapActivity {
  id: string;
  name: string;
  type: string;
  startDate: string;
  coordinates: [number, number][];
  distanceMeters: number | null;
}

interface MapBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface HeatmapMapProps {
  activities: HeatmapActivity[];
  bounds: MapBounds | null;
  showHeatmap: boolean;
  showRoutes: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  run: "#3b82f6",
  ride: "#f59e0b",
  swim: "#06b6d4",
  hike: "#22c55e",
  workout: "#a855f7",
  other: "#6b7280",
};

const HEAT_GRADIENT: Record<number, string> = {
  0.4: "#3b82f6",
  0.6: "#22c55e",
  0.7: "#facc15",
  0.8: "#f97316",
  1.0: "#ef4444",
};

/**
 * Full-viewport Leaflet map with an optional heat layer (via leaflet.heat)
 * and optional per-activity route polylines.
 *
 * The map instance is created once on mount and held in a ref — data/layer
 * changes flow through effects, never through re-mounting the map.
 */
export default function HeatmapMap({
  activities,
  bounds,
  showHeatmap,
  showRoutes,
}: HeatmapMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const heatLayerRef = useRef<L.HeatLayer | null>(null);
  const polylineGroupRef = useRef<L.LayerGroup | null>(null);

  // ── Mount: create map + tile layer + empty overlay layers ────
  useEffect(() => {
    if (mapInstanceRef.current || !mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    const heatLayer = L.heatLayer([], {
      radius: 18,
      blur: 22,
      maxZoom: 17,
      max: 0.5,
      gradient: HEAT_GRADIENT,
    }).addTo(map);

    const polylineGroup = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;
    heatLayerRef.current = heatLayer;
    polylineGroupRef.current = polylineGroup;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      heatLayerRef.current = null;
      polylineGroupRef.current = null;
    };
  }, []);

  // ── Data effect: update heat layer + polylines ───────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Heat layer
    const heatLayer = heatLayerRef.current;
    if (heatLayer) {
      if (showHeatmap && activities.length > 0) {
        const allCoords: [number, number][] = activities.flatMap(
          (a) => a.coordinates
        );
        heatLayer.setLatLngs(allCoords);
        if (!map.hasLayer(heatLayer)) map.addLayer(heatLayer);
      } else {
        if (map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
      }
    }

    // Polyline layer
    const polylineGroup = polylineGroupRef.current;
    if (polylineGroup) {
      polylineGroup.clearLayers();
      if (showRoutes && activities.length > 0) {
        activities.forEach((activity) => {
          if (activity.coordinates.length < 3) return;
          const polyline = L.polyline(activity.coordinates, {
            color: TYPE_COLORS[activity.type] || TYPE_COLORS.other,
            weight: 2,
            opacity: 0.6,
          });
          polyline.bindTooltip(activity.name, { sticky: true });
          polylineGroup.addLayer(polyline);
        });
        if (!map.hasLayer(polylineGroup)) map.addLayer(polylineGroup);
      } else {
        if (map.hasLayer(polylineGroup)) map.removeLayer(polylineGroup);
      }
    }
  }, [activities, showHeatmap, showRoutes]);

  // ── Bounds effect: fit map to data bounds ────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !bounds) return;

    const leafletBounds = L.latLngBounds(
      [bounds.minLat, bounds.minLng],
      [bounds.maxLat, bounds.maxLng]
    );

    if (leafletBounds.isValid()) {
      map.fitBounds(leafletBounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [bounds]);

  return (
    <div
      ref={mapContainerRef}
      className="absolute inset-0 z-0"
      style={{ minHeight: "100%" }}
    />
  );
}
