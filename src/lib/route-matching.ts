/**
 * Route fingerprinting & matching.
 *
 * Identifies activities that follow the same route by comparing
 * simplified GPS tracks. Used to show "Same Route" comparisons
 * on the training log detail page.
 */

export interface RoutePoint {
  lat: number;
  lon: number;
}

export interface RouteMatch {
  id: string;
  name: string;
  startDate: string;
  durationSeconds: number;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  averageHr: number | null;
  maxHr: number | null;
  tss: number | null;
  similarity: number; // 0–100
}

// ─── Track simplification ─────────────────────────────────────

/**
 * Reduce a GPS track to at most `maxPoints` by taking evenly-spaced points.
 * Always includes first and last point.
 */
export function simplifyTrack(points: RoutePoint[], maxPoints: number = 60): RoutePoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.floor(points.length / (maxPoints - 1));
  const result: RoutePoint[] = [points[0]];
  for (let i = step; i < points.length - step; i += step) {
    result.push(points[i]);
  }
  result.push(points[points.length - 1]);
  return result;
}

// ─── Distance between two points (meters) ─────────────────────

function pointDistance(a: RoutePoint, b: RoutePoint): number {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const aVal =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return R * 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ─── Minimum distance from point to track ─────────────────────

/** Shortest distance from a point to any segment of the track. */
function minDistanceToTrack(point: RoutePoint, track: RoutePoint[]): number {
  let minDist = Infinity;
  for (let i = 0; i < track.length - 1; i++) {
    const dist = pointToSegmentDistance(point, track[i], track[i + 1]);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

function pointToSegmentDistance(p: RoutePoint, a: RoutePoint, b: RoutePoint): number {
  const abDist = pointDistance(a, b);
  if (abDist < 0.01) return pointDistance(p, a);

  // Project p onto line ab, clamp to segment
  const dx = b.lat - a.lat;
  const dy = b.lon - a.lon;
  let t = ((p.lat - a.lat) * dx + (p.lon - a.lon) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));

  const proj: RoutePoint = {
    lat: a.lat + t * dx,
    lon: a.lon + t * dy,
  };
  return pointDistance(p, proj);
}

// ─── Bidirectional overlap score ──────────────────────────────

/**
 * Compute how similar two tracks are.
 *
 * For each point in track A, find the distance to track B.
 * Count points within `threshold` meters as "matched".
 * Do the same for B → A, then average the two percentages.
 *
 * Returns similarity percentage (0–100).
 */
export function computeTrackSimilarity(
  trackA: RoutePoint[],
  trackB: RoutePoint[],
  thresholdMeters: number = 50,
): number {
  if (trackA.length < 3 || trackB.length < 3) return 0;

  const simplifiedA = simplifyTrack(trackA, 60);
  const simplifiedB = simplifyTrack(trackB, 60);

  // A → B: % of A's points within threshold of B
  let matchedA = 0;
  for (const pt of simplifiedA) {
    if (minDistanceToTrack(pt, simplifiedB) <= thresholdMeters) {
      matchedA++;
    }
  }
  const scoreAB = matchedA / simplifiedA.length;

  // B → A: % of B's points within threshold of A
  let matchedB = 0;
  for (const pt of simplifiedB) {
    if (minDistanceToTrack(pt, simplifiedA) <= thresholdMeters) {
      matchedB++;
    }
  }
  const scoreBA = matchedB / simplifiedB.length;

  return Math.round(((scoreAB + scoreBA) / 2) * 100);
}

// ─── Route fingerprint (for fast DB pre-filtering) ────────────

export interface RouteFingerprint {
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  totalDistance: number;
}

/** Create a coarse fingerprint from trackpoints for DB queries. */
export function createFingerprint(trackPoints: RoutePoint[], distanceMeters: number | null): RouteFingerprint | null {
  if (trackPoints.length < 3) return null;
  const first = trackPoints[0];
  const last = trackPoints[trackPoints.length - 1];
  if (!first.lat || !first.lon || !last.lat || !last.lon) return null;

  return {
    startLat: Math.round(first.lat * 1000) / 1000, // 3 decimal places ≈ 111m
    startLon: Math.round(first.lon * 1000) / 1000,
    endLat: Math.round(last.lat * 1000) / 1000,
    endLon: Math.round(last.lon * 1000) / 1000,
    totalDistance: distanceMeters || 0,
  };
}
