/**
 * Trackpoint → chart data utilities.
 *
 * These functions downsample and transform raw trackPoint arrays into
 * chart-ready data for Recharts, splits tables, and route maps.
 */
import { TrackPoint } from "./gpx-parser";

// ─── Downsampling ────────────────────────────────────────────

/** Reduce N points to at most `maxPoints` by taking every Nth. */
export function downsample<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

// ─── Splits ──────────────────────────────────────────────────

export interface Split {
  km: number;          // split number (1-indexed)
  distance: number;    // cumulative meters at end of split
  timeSec: number;     // elapsed seconds at end of split
  splitSec: number;    // duration of this split
  pace: number | null; // min/km for this split
  avgHr: number | null;
  gainM: number;       // cumulative elevation gained in this split (sum of upward deltas)
  lossM: number;       // cumulative elevation lost in this split (sum of downward deltas)
}

/** Compute per-kilometer splits from trackpoints. */
export function computeSplits(
  trackPoints: TrackPoint[],
  splitMeters: number = 1000,
): Split[] {
  if (trackPoints.length < 5) return [];

  const hasTime = trackPoints.some((tp) => tp.time != null);
  const hasDist = trackPoints.some((tp) => tp.distance != null);

  if (!hasTime) return [];

  const splits: Split[] = [];
  let splitStartIdx = 0;
  let splitStartDist = hasDist ? (trackPoints[0].distance || 0) : 0;
  let splitStartTime = new Date(trackPoints[0].time!).getTime();
  let splitGain = 0;
  let splitLoss = 0;
  let lastEle = trackPoints[0].ele;
  let hrSum = 0;
  let hrCount = 0;
  let km = 1;

  for (let i = 1; i < trackPoints.length; i++) {
    const tp = trackPoints[i];
    const dist = tp.distance || 0;
    const gap = dist - splitStartDist;

    // Track cumulative elevation gain/loss from consecutive point deltas
    if (tp.ele != null && lastEle != null) {
      const delta = tp.ele - lastEle;
      if (delta > 0) splitGain += delta;
      else splitLoss -= delta; // store as positive value
    }
    if (tp.ele != null) lastEle = tp.ele;

    if (tp.hr != null && tp.hr > 0) {
      hrSum += tp.hr;
      hrCount++;
    }

    if (gap >= splitMeters || i === trackPoints.length - 1) {
      const endTime = tp.time ? new Date(tp.time).getTime() : splitStartTime;
      const elapsed = (endTime - splitStartTime) / 1000;
      const splitPace = elapsed > 0 && gap > 0
        ? (elapsed / 60) / (gap / 1000) // min/km
        : null;

      splits.push({
        km,
        distance: dist,
        timeSec: Math.round(elapsed),
        splitSec: Math.round(elapsed),
        pace: splitPace ? Math.round(splitPace * 100) / 100 : null,
        avgHr: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
        gainM: Math.round(splitGain),
        lossM: Math.round(splitLoss),
      });

      splitStartIdx = i;
      splitStartDist = dist;
      splitStartTime = endTime;
      splitGain = 0;
      splitLoss = 0;
      lastEle = tp.ele;
      hrSum = 0;
      hrCount = 0;
      km++;
    }
  }

  // Fix cumulative times
  let cumTime = 0;
  for (const s of splits) {
    cumTime += s.splitSec;
    s.timeSec = cumTime;
  }

  return splits;
}

// ─── Elevation Profile ───────────────────────────────────────

export interface ElevationPoint {
  distance: number; // meters
  ele: number;      // meters
}

export function computeElevationProfile(trackPoints: TrackPoint[]): ElevationPoint[] {
  const valid = trackPoints.filter((tp) => tp.ele != null);
  if (valid.length < 3) return [];

  const hasDist = valid.some((tp) => tp.distance != null);
  let cumDist = 0;
  let lastLat: number | null = null;
  let lastLon: number | null = null;

  const points: ElevationPoint[] = [];
  for (const tp of valid) {
    if (hasDist && tp.distance != null) {
      cumDist = tp.distance;
    } else if (tp.lat != null && tp.lon != null) {
      if (lastLat != null) {
        cumDist += haversine(lastLat, lastLon!, tp.lat, tp.lon) * 1000;
      }
      lastLat = tp.lat;
      lastLon = tp.lon;
    }
    points.push({ distance: Math.round(cumDist), ele: Math.round(tp.ele! * 10) / 10 });
  }

  return downsample(points, 500);
}

// ─── Heart Rate Profile ──────────────────────────────────────

export interface HrPoint {
  distance: number;
  hr: number;
}

export function computeHrProfile(trackPoints: TrackPoint[]): HrPoint[] {
  const valid = trackPoints.filter((tp) => tp.hr != null && tp.hr > 0);
  if (valid.length < 3) return [];

  const distPoints = computeElevationProfile(trackPoints); // reuse distance tracking
  const hrByDist: HrPoint[] = [];

  let distIdx = 0;
  let cumDist = 0;
  let lastLat: number | null = null;
  let lastLon: number | null = null;

  for (const tp of valid) {
    if (tp.distance != null) {
      cumDist = tp.distance;
    } else if (tp.lat != null && tp.lon != null) {
      if (lastLat != null) {
        cumDist += haversine(lastLat, lastLon!, tp.lat, tp.lon) * 1000;
      }
      lastLat = tp.lat;
      lastLon = tp.lon;
    }
    hrByDist.push({ distance: Math.round(cumDist), hr: tp.hr! });
    distIdx++;
  }

  return downsample(hrByDist, 500);
}

// ─── Pace Profile ────────────────────────────────────────────

export interface PacePoint {
  distance: number;
  pace: number; // min/km
  speed: number; // m/s
}

export function computePaceProfile(trackPoints: TrackPoint[]): PacePoint[] {
  const withSpeed = trackPoints.filter((tp) => tp.speed != null && tp.speed > 0);
  if (withSpeed.length > 5) {
    // Use direct speed data — downsample and convert to pace
    const pts: PacePoint[] = [];
    let cumDist = 0;
    let lastLat: number | null = null;
    let lastLon: number | null = null;

    for (const tp of withSpeed) {
      if (tp.distance != null) {
        cumDist = tp.distance;
      } else if (tp.lat != null && tp.lon != null) {
        if (lastLat != null) cumDist += haversine(lastLat, lastLon!, tp.lat, tp.lon) * 1000;
        lastLat = tp.lat;
        lastLon = tp.lon;
      }
      const paceMs = 16.6667 / tp.speed!; // m/s → min/km
      const smoothedSpeed = Math.round(tp.speed! * 10) / 10;
      pts.push({
        distance: Math.round(cumDist),
        pace: Math.round(paceMs * 100) / 100,
        speed: smoothedSpeed,
      });
    }
    return smoothPace(downsample(pts, 500));
  }

  // Compute from distance/time deltas
  const withTime = trackPoints.filter((tp) => tp.time != null);
  if (withTime.length < 5) return [];

  const pts: PacePoint[] = [];
  let cumDist = 0;
  let lastLat: number | null = null;
  let lastLon: number | null = null;
  let lastTime = new Date(withTime[0].time!).getTime();

  for (let i = 1; i < withTime.length; i++) {
    const tp = withTime[i];
    if (tp.distance != null) {
      cumDist = tp.distance;
    } else if (tp.lat != null && tp.lon != null) {
      if (lastLat != null) cumDist += haversine(lastLat, lastLon!, tp.lat, tp.lon) * 1000;
      lastLat = tp.lat;
      lastLon = tp.lon;
    }
    const now = new Date(tp.time!).getTime();
    const dt = (now - lastTime) / 1000;
    if (dt > 0) {
      const speed = (cumDist - (pts[pts.length - 1]?.distance || 0)) / dt;
      if (speed > 0 && speed < 20) { // filter unreasonable speeds
        pts.push({
          distance: Math.round(cumDist),
          pace: Math.round((16.6667 / speed) * 100) / 100,
          speed: Math.round(speed * 10) / 10,
        });
      }
    }
    lastTime = now;
  }

  return smoothPace(downsample(pts, 500));
}

function smoothPace(points: PacePoint[]): PacePoint[] {
  if (points.length < 5) return points;
  const window = 5;
  const result: PacePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const start = Math.max(0, i - Math.floor(window / 2));
    const end = Math.min(points.length, i + Math.floor(window / 2) + 1);
    const slice = points.slice(start, end);
    result.push({
      distance: points[i].distance,
      pace: Math.round((slice.reduce((s, p) => s + p.pace, 0) / slice.length) * 100) / 100,
      speed: Math.round((slice.reduce((s, p) => s + p.speed, 0) / slice.length) * 10) / 10,
    });
  }
  return result;
}

// ─── Power Profile ───────────────────────────────────────────

export interface PowerPoint {
  timeSec: number; // seconds from start
  power: number;
  smoothedPower: number; // 30s moving average
}

export function computePowerProfile(trackPoints: TrackPoint[]): PowerPoint[] {
  const withPower = trackPoints.filter((tp) => tp.power != null && tp.power >= 0);
  if (withPower.length < 10) return [];

  let startTime = 0;
  if (withPower[0].time) startTime = new Date(withPower[0].time).getTime();

  const raw: { timeSec: number; power: number }[] = [];
  for (const tp of withPower) {
    const t = tp.time ? (new Date(tp.time).getTime() - startTime) / 1000 : raw.length;
    raw.push({ timeSec: Math.round(t), power: tp.power! });
  }

  const downsampled = downsample(raw, 500);

  // 30s rolling average
  return downsampled.map((pt, i) => {
    const start = Math.max(0, i - 14);
    const end = Math.min(raw.length, i + 15);
    const slice = raw.slice(start, end);
    const smoothed = Math.round(slice.reduce((s, p) => s + p.power, 0) / slice.length);
    return { timeSec: pt.timeSec, power: pt.power, smoothedPower: smoothed };
  });
}

// ─── Grade-Adjusted Pace ─────────────────────────────────────

export function computeGradeAdjustedPace(
  trackPoints: TrackPoint[],
): { distance: number; pace: number; gap: number }[] {
  const paceProfile = computePaceProfile(trackPoints);
  const eleProfile = computeElevationProfile(trackPoints);
  if (paceProfile.length < 3 || eleProfile.length < 3) return [];

  // Match pace points to elevation by distance
  const result: { distance: number; pace: number; gap: number }[] = [];
  for (const pp of paceProfile) {
    // Find nearest elevation point
    let closest = eleProfile[0];
    let minDiff = Infinity;
    for (const ep of eleProfile) {
      const diff = Math.abs(ep.distance - pp.distance);
      if (diff < minDiff) { minDiff = diff; closest = ep; }
    }
    // Find grade over surrounding 200m
    const nearby = eleProfile.filter((ep) => Math.abs(ep.distance - pp.distance) <= 200);
    let grade = 0;
    if (nearby.length >= 2) {
      const first = nearby[0];
      const last = nearby[nearby.length - 1];
      const distDiff = last.distance - first.distance;
      if (distDiff > 0) {
        grade = (last.ele - first.ele) / distDiff; // rise/run as decimal
      }
    }
    // GAP adjustment: ~3.3% pace adjustment per 1% grade (Minetti et al.)
    const gap = Math.round((pp.pace / (1 + grade * 3.3)) * 100) / 100;
    result.push({ distance: pp.distance, pace: pp.pace, gap });
  }

  return downsample(result, 500);
}

// ─── VAM (Vertical Ascent Speed) ─────────────────────────────

export function computeVam(trackPoints: TrackPoint[]): {
  totalGain: number;
  vamTotal: number;    // m/h over entire activity
  peakVam30min: number; // best 30-min climbing rate
} | null {
  const elevPoints = trackPoints.filter((tp) => tp.ele != null && tp.time != null);
  if (elevPoints.length < 10) return null;

  let totalGain = 0;
  let lastEle: number | null = null;
  let startTime = new Date(elevPoints[0].time!).getTime();
  const totalSec = (new Date(elevPoints[elevPoints.length - 1].time!).getTime() - startTime) / 1000;

  // Track gain + time per segment for peak 30-min
  const segments: { time: number; gain: number }[] = [];
  let segStartTime = startTime;
  let segGain = 0;

  for (const tp of elevPoints) {
    if (lastEle != null && tp.ele! > lastEle) {
      totalGain += tp.ele! - lastEle;
      segGain += tp.ele! - lastEle;
    }
    lastEle = tp.ele!;

    const t = new Date(tp.time!).getTime();
    if (t - segStartTime >= 30 * 60 * 1000) {
      segments.push({ time: (t - segStartTime) / 1000, gain: segGain });
      segStartTime = t;
      segGain = 0;
    }
  }
  // Last partial segment
  if (segGain > 0) segments.push({ time: (new Date(elevPoints[elevPoints.length - 1].time!).getTime() - segStartTime) / 1000, gain: segGain });

  const vamTotal = totalSec > 0 ? Math.round((totalGain / totalSec) * 3600) : 0;
  const peakVam30min = segments.length > 0
    ? Math.max(...segments.map((s) => s.time > 0 ? Math.round((s.gain / s.time) * 3600) : 0))
    : vamTotal;

  return { totalGain: Math.round(totalGain), vamTotal, peakVam30min };
}

// ─── Route Map ───────────────────────────────────────────────

export interface RoutePoint {
  x: number; y: number;
  lat: number; lon: number;
}

export function extractRoutePoints(trackPoints: TrackPoint[]): RoutePoint[] {
  const valid = trackPoints.filter((tp) => tp.lat != null && tp.lon != null);
  if (valid.length < 3) return [];

  const downsampled = downsample(valid, 300);

  // Find bounding box
  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;
  for (const tp of downsampled) {
    minLat = Math.min(minLat, tp.lat!);
    maxLat = Math.max(maxLat, tp.lat!);
    minLon = Math.min(minLon, tp.lon!);
    maxLon = Math.max(maxLon, tp.lon!);
  }

  const padding = 0.05;
  const rangeLat = (maxLat - minLat) || 0.001;
  const rangeLon = (maxLon - minLon) || 0.001;

  // Scale to 0-100 coordinate space
  return downsampled.map((tp) => ({
    lat: tp.lat!,
    lon: tp.lon!,
    x: ((tp.lat! - minLat) / rangeLat) * 100,
    y: 100 - ((tp.lon! - minLon) / rangeLon) * 100, // flip for screen coords
  }));
}

/**
 * Extract lat/lon pairs from trackpoints for heatmap rendering.
 * Returns raw [lat, lon] arrays (no 0-100 screen-coordinate normalization).
 */
export function extractHeatmapPoints(
  trackPoints: TrackPoint[],
  maxPoints = 200
): [number, number][] {
  const valid = trackPoints.filter(
    (tp): tp is TrackPoint & { lat: number; lon: number } =>
      tp.lat != null && tp.lon != null
  );
  if (valid.length < 3) return [];
  return downsample(valid, maxPoints).map((tp) => [tp.lat, tp.lon]);
}

// ─── HR Zone Breakdown ───────────────────────────────────────

export interface HrZoneBreakdown {
  zones: { zone: number; label: string; pct: number; timeMin: number; lowerBpm: number; upperBpm: number }[];
}

/** Compute time-in-HR-zone as percentages. */
export function computeHrZoneBreakdown(
  trackPoints: TrackPoint[],
  maxHr: number,
  restingHr?: number,
): HrZoneBreakdown | null {
  const hrPoints = trackPoints.filter((tp) => tp.hr != null && tp.hr > 0);
  if (hrPoints.length < 10 || maxHr <= 0) return null;

  const hrReserve = restingHr ? maxHr - restingHr : maxHr;
  const baseHr = restingHr || 0;

  // 5-zone model
  const zonePcts = [0.68, 0.83, 0.94, 1.05, 1.0]; // upper bounds as % of maxHR/HRR
  const labels = [
    "Z1 · Recovery",
    "Z2 · Endurance",
    "Z3 · Tempo",
    "Z4 · Threshold",
    "Z5 · VO2Max",
  ];
  const colors = ["#6b7280", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7"];

  const timeInZone = [0, 0, 0, 0, 0];
  const upperBounds = zonePcts.map((pct) => Math.round(baseHr + hrReserve * pct));

  for (const tp of hrPoints) {
    const hr = tp.hr!;
    if (hr <= upperBounds[0]) timeInZone[0]++;
    else if (hr <= upperBounds[1]) timeInZone[1]++;
    else if (hr <= upperBounds[2]) timeInZone[2]++;
    else if (hr <= upperBounds[3]) timeInZone[3]++;
    else timeInZone[4]++;
  }

  const total = timeInZone.reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const zones = timeInZone.map((count, i) => ({
    zone: i + 1,
    label: labels[i],
    pct: Math.round((count / total) * 1000) / 10,
    timeMin: Math.round(count / 60),
    lowerBpm: i === 0 ? baseHr : upperBounds[i - 1],
    upperBpm: upperBounds[i],
  }));

  return { zones };
}

// ─── Lap Data ────────────────────────────────────────────────

export interface LapSummary {
  index: number;
  durationSec: number;
  distanceM: number;
  pace: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgPower: number | null;
  gainM: number | null;
}

/** Extract TCX-style lap data from rawJson if present. Falls back to trackpoint splits. */
export function extractLaps(rawJson: Record<string, unknown> | null): LapSummary[] | null {
  if (!rawJson) return null;
  const laps = rawJson.laps as any[] | undefined;
  if (!laps || !Array.isArray(laps) || laps.length === 0) return null;

  return laps.map((lap: any, i: number) => ({
    index: i + 1,
    durationSec: Math.round(lap.totalTimeSeconds || 0),
    distanceM: Math.round(lap.distanceMeters || 0),
    pace: lap.totalTimeSeconds > 0 && lap.distanceMeters > 0
      ? Math.round(((lap.totalTimeSeconds / 60) / (lap.distanceMeters / 1000)) * 100) / 100
      : null,
    avgHr: lap.averageHr || null,
    maxHr: lap.maxHr || null,
    avgPower: lap.averagePower || null,
    gainM: null, // elevation gain per lap not typically in TCX lap data
  }));
}

// ─── Haversine distance ──────────────────────────────────────

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ─── Formatting helpers ──────────────────────────────────────

export function formatSplitPace(paceMinPerKm: number | null, type?: string): string {
  if (paceMinPerKm == null || paceMinPerKm <= 0) return "--:--";
  let pace = paceMinPerKm;
  let unit = "/km";
  if (type === "swim") {
    pace = paceMinPerKm / 10; // min/km → min/100m
    unit = "/100m";
  }
  const min = Math.floor(pace);
  const sec = Math.round((pace - min) * 60);
  return `${min}:${sec.toString().padStart(2, "0")} ${unit}`;
}

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Combined Chart Data ─────────────────────────────────────

export interface CombinedDataPoint {
  distance: number;
  timeSec: number;
  ele: number | null;
  hr: number | null;
  pace: number | null;
  gap: number | null;
  power: number | null;
  smoothedPower: number | null;
}

/** Build a distance↔time lookup from trackpoints. Returns (distance→timeSec) and (timeSec→distance) closures. */
function buildCoordMap(trackPoints: TrackPoint[]): {
  distToTime: (dist: number) => number | null;
  timeToDist: (timeSec: number) => number | null;
} {
  const pairs: { dist: number; timeSec: number }[] = [];
  let cumDist = 0;
  const startTime = trackPoints[0]?.time ? new Date(trackPoints[0].time).getTime() : 0;
  let lastLat: number | null = null;
  let lastLon: number | null = null;
  const hasDist = trackPoints.some((tp) => tp.distance != null);

  for (const tp of trackPoints) {
    if (hasDist && tp.distance != null) {
      cumDist = tp.distance;
    } else if (tp.lat != null && tp.lon != null && lastLat != null && lastLon != null) {
      cumDist += haversine(lastLat, lastLon, tp.lat, tp.lon) * 1000;
    }
    lastLat = tp.lat ?? lastLat;
    lastLon = tp.lon ?? lastLon;
    const timeSec = tp.time ? (new Date(tp.time).getTime() - startTime) / 1000 : pairs.length;
    pairs.push({ dist: cumDist, timeSec });
  }

  function interpolate(target: number, extract: (p: typeof pairs[0]) => number): number | null {
    if (pairs.length === 0) return null;
    if (target <= extract(pairs[0])) return pairs[0].timeSec;
    if (target >= extract(pairs[pairs.length - 1])) return pairs[pairs.length - 1].timeSec;
    let lo = 0, hi = pairs.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (extract(pairs[mid]) < target) lo = mid;
      else hi = mid;
    }
    const p0 = pairs[lo], p1 = pairs[hi];
    const v0 = extract(p0), v1 = extract(p1);
    if (v1 === v0) return p0.timeSec;
    const t = (target - v0) / (v1 - v0);
    return p0.timeSec + t * (p1.timeSec - p0.timeSec);
  }

  return {
    distToTime: (dist) => interpolate(dist, (p) => p.dist),
    timeToDist: (timeSec) => {
      const result = interpolate(timeSec, (p) => p.timeSec);
      if (result == null) return null;
      // interpolate returns timeSec, we need dist — search again
      let lo = 0, hi = pairs.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (pairs[mid].timeSec < timeSec) lo = mid;
        else hi = mid;
      }
      const p0 = pairs[lo], p1 = pairs[hi];
      const v0 = p0.timeSec, v1 = p1.timeSec;
      if (v1 === v0) return p0.dist;
      const t = (timeSec - v0) / (v1 - v0);
      return p0.dist + t * (p1.dist - p0.dist);
    },
  };
}

/** Find the nearest value for a given x key in a profile array. */
function nearestValue(
  arr: Record<string, unknown>[],
  targetX: number,
  xKey: string,
  yKey: string,
): number | null {
  if (arr.length === 0) return null;
  let best = arr[0];
  let bestDist = Infinity;
  for (const pt of arr) {
    const x = pt[xKey];
    if (typeof x !== "number") continue;
    const d = Math.abs(x - targetX);
    if (d < bestDist) { bestDist = d; best = pt; }
  }
  const val = best[yKey];
  return typeof val === "number" ? val : null;
}

/** Produce combined chart data aligned to distance (m) x-axis. */
export function computeCombinedDistanceData(trackPoints: TrackPoint[]): CombinedDataPoint[] {
  const paceProfile = computePaceProfile(trackPoints);
  if (paceProfile.length < 3) return [];

  const elevProfile = computeElevationProfile(trackPoints);
  const hrProfile = computeHrProfile(trackPoints);
  const gapProfile = computeGradeAdjustedPace(trackPoints);
  const powerProfile = computePowerProfile(trackPoints);
  const coord = buildCoordMap(trackPoints);

  return paceProfile.map((pp) => {
    const timeAtDist = coord.distToTime(pp.distance);
    const ele = nearestValue(elevProfile as unknown as Record<string, unknown>[], pp.distance, "distance", "ele");
    const hr = nearestValue(hrProfile as unknown as Record<string, unknown>[], pp.distance, "distance", "hr");
    const gapVal = nearestValue(gapProfile as unknown as Record<string, unknown>[], pp.distance, "distance", "gap");
    let power: number | null = null;
    let smoothedPower: number | null = null;
    if (timeAtDist != null) {
      power = nearestValue(powerProfile as unknown as Record<string, unknown>[], timeAtDist, "timeSec", "power");
      smoothedPower = nearestValue(powerProfile as unknown as Record<string, unknown>[], timeAtDist, "timeSec", "smoothedPower");
    }
    return {
      distance: pp.distance,
      timeSec: Math.round(timeAtDist ?? 0),
      ele,
      hr,
      pace: pp.pace,
      gap: gapVal,
      power,
      smoothedPower,
    };
  });
}

/** Produce combined chart data aligned to time (seconds) x-axis. */
export function computeCombinedTimeData(trackPoints: TrackPoint[]): CombinedDataPoint[] {
  const powerProfile = computePowerProfile(trackPoints);
  if (powerProfile.length < 3) return [];

  const elevProfile = computeElevationProfile(trackPoints);
  const hrProfile = computeHrProfile(trackPoints);
  const paceProfile = computePaceProfile(trackPoints);
  const gapProfile = computeGradeAdjustedPace(trackPoints);
  const coord = buildCoordMap(trackPoints);

  return powerProfile.map((pp) => {
    const distAtTime = coord.timeToDist(pp.timeSec);
    const ele = distAtTime != null
      ? nearestValue(elevProfile as unknown as Record<string, unknown>[], distAtTime, "distance", "ele") : null;
    const hr = distAtTime != null
      ? nearestValue(hrProfile as unknown as Record<string, unknown>[], distAtTime, "distance", "hr") : null;
    const pace = distAtTime != null
      ? nearestValue(paceProfile as unknown as Record<string, unknown>[], distAtTime, "distance", "pace") : null;
    const gap = distAtTime != null
      ? nearestValue(gapProfile as unknown as Record<string, unknown>[], distAtTime, "distance", "gap") : null;
    return {
      distance: Math.round(distAtTime ?? 0),
      timeSec: pp.timeSec,
      ele,
      hr,
      pace,
      gap,
      power: pp.power,
      smoothedPower: pp.smoothedPower,
    };
  });
}
