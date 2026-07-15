/**
 * Simplify raw trackpoints to a compact coordinate array for storage
 * and fast retrieval in heatmap/route views.
 *
 * The stored format is a simple array of [lat, lon] pairs — no TrackPoint
 * objects, no metadata. This keeps the column tiny and avoids re-parsing
 * the full rawJson just to render the heatmap.
 *
 * Also computes the bounding box of the track for spatial index queries
 * (used by the tile server to efficiently find intersecting tiles).
 */
import type { TrackPoint } from "./gpx-parser";
import { downsample } from "./trackpoint-charts";

export interface SimplifiedResult {
  /** Downsampled [lat, lon] pairs, at most `maxPoints`. */
  coords: [number, number][];
  /** Bounding box of the track, or null if fewer than 3 valid coords. */
  bbox: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  } | null;
}

/**
 * Downsample a full trackPoint array to at most `maxPoints` valid
 * [lat, lon] pairs. Points with null lat or lon are dropped.
 *
 * Returns an empty coord array and null bbox when fewer than 3 valid
 * points remain.
 */
export function simplifyTrackPoints(
  trackPoints: TrackPoint[] | undefined | null,
  maxPoints = 500,
): SimplifiedResult {
  const empty: SimplifiedResult = { coords: [], bbox: null };

  if (!trackPoints || trackPoints.length === 0) return empty;

  const valid = trackPoints.filter(
    (tp): tp is TrackPoint & { lat: number; lon: number } =>
      tp.lat != null && tp.lon != null,
  );

  if (valid.length < 3) return empty;

  // Compute bbox from all valid points (before downsampling for max accuracy)
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  for (const tp of valid) {
    if (tp.lat < minLat) minLat = tp.lat;
    if (tp.lat > maxLat) maxLat = tp.lat;
    if (tp.lon < minLng) minLng = tp.lon;
    if (tp.lon > maxLng) maxLng = tp.lon;
  }

  const coords = downsample(valid, maxPoints).map((tp) => [tp.lat, tp.lon] as [number, number]);

  return {
    coords,
    bbox: { minLat, maxLat, minLng, maxLng },
  };
}
