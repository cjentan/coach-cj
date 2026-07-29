/**
 * Parses GPX and TCX files into structured activity data.
 *
 * GPX (GPS Exchange Format):
 *   <gpx><trk><name>...</name><trkseg><trkpt lat="..." lon="...">
 *     <ele>...</ele><time>...</time><extensions><gpxtpx:TrackPointExtension>
 *       <gpxtpx:hr>...</gpxtpx:hr><gpxtpx:cad>...</gpxtpx:cad>
 *     </gpxtpx:TrackPointExtension></extensions>
 *   </trkpt></trkseg></trk></gpx>
 *
 * TCX (Training Center XML, Garmin's format):
 *   <TrainingCenterDatabase><Activities><Activity Sport="Running">
 *     <Lap><TotalTimeSeconds>...</TotalTimeSeconds>
 *     <DistanceMeters>...</DistanceMeters>
 *     <Cadence>...</Cadence>
 *     <Extensions><LX><AvgWatts>...</AvgWatts></LX></Extensions>
 *     <Track><Trackpoint>
 *       <Time>...</Time><DistanceMeters>...</DistanceMeters>
 *       <HeartRateBpm><Value>...</Value></HeartRateBpm>
 *       <Cadence>...</Cadence>
 *       <AltitudeMeters>...</AltitudeMeters>
 *       <Extensions><TPX><Watts>...</Watts><Speed>...</Speed></TPX></Extensions>
 *     </Trackpoint></Track>
 *   </Lap></Activity></Activities></TrainingCenterDatabase>
 */
import { ActivityType, ActivitySubType, ActivitySource } from "@prisma/client";
import { generateBaseName } from "./activity-naming";
import { haversine } from "./utils";
import {
  computeNormalizedPower,
  computePowerTss,
  computeHrTssEstimate,
  estimateTss,
} from "@/lib/training-math";
import { inferFromName } from "./sport-mappings";

export interface TrackPoint {
  lat: number | null;
  lon: number | null;
  ele: number | null;
  time: string | null;
  hr: number | null;
  cadence: number | null;
  power: number | null;
  distance: number | null;
  speed: number | null;
}

export interface LapData {
  startTime: string | null;
  totalTimeSeconds: number;
  distanceMeters: number | null;
  calories: number | null;
  averageHr: number | null;
  maxHr: number | null;
  averageCadence: number | null;
  averagePower: number | null;
  intensity: string | null;
  trigger: string | null;
}

export interface ParsedFileActivity {
  name: string;
  type: ActivityType;
  subType: ActivitySubType | null;
  startDate: Date;
  durationSeconds: number;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  averageHr: number | null;
  maxHr: number | null;
  averagePower: number | null;
  maxPower: number | null;
  normalizedPower: number | null;
  averageCadence: number | null;
  maxCadence: number | null;
  calories: number | null;
  tss: number | null;
  description: string | null;
  trackPoints: TrackPoint[];
  laps: LapData[];
  /** Device-local timestamp from the source file (e.g. Garmin FIT local_timestamp).
   *  Provides the correct time-of-day regardless of server timezone. */
  localTimestamp?: Date | null;
}

// Simple XML tag content extraction (avoids dependency on xml2js)
function getTagContent(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function getTagContentAll(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const results: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

function getAttr(xml: string, tag: string, attr: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"[^>]*>`, "i");
  const match = xml.match(regex);
  return match ? match[1] : null;
}

// Extract extension values with namespace tolerance (e.g. <gpxtpx:hr>, <tpx:Watts>, <Watts>)
function getExtensionValue(xml: string, tag: string): number | null {
  // Try namespaced variants first, then bare tag
  const patterns = [
    new RegExp(`<[^>]*:${tag}[^>]*>([\\s\\S]*?)<\\/[^>]*:${tag}>`, "i"),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"),
  ];
  for (const regex of patterns) {
    const match = xml.match(regex);
    if (match) {
      const n = parseFloat(match[1].trim());
      if (!isNaN(n)) return n;
    }
  }
  return null;
}

function parseFloatOrNull(val: string | null): number | null {
  if (!val) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

// ─── Lap-level parsing ──────────────────────────────────────

function parseLap(lapXml: string): LapData {
  const calories = parseFloatOrNull(getTagContent(lapXml, "Calories"));
  const avgHr = parseFloatOrNull(getTagContent(getTagContent(lapXml, "AverageHeartRateBpm") || "", "Value"));
  const maxHr = parseFloatOrNull(getTagContent(getTagContent(lapXml, "MaximumHeartRateBpm") || "", "Value"));
  const avgCadence = parseFloatOrNull(getTagContent(lapXml, "Cadence"));
  const intensity = getTagContent(lapXml, "Intensity");
  const trigger = getTagContent(lapXml, "TriggerMethod");

  // TCX lap extensions (Garmin)
  const extensions = getTagContent(lapXml, "Extensions");
  let avgPower: number | null = null;
  if (extensions) {
    avgPower = getExtensionValue(extensions, "AvgWatts");
  }

  return {
    startTime: getAttr(lapXml, "StartTime", "") || null,
    totalTimeSeconds: parseFloat(getTagContent(lapXml, "TotalTimeSeconds") || "0"),
    distanceMeters: parseFloatOrNull(getTagContent(lapXml, "DistanceMeters")),
    calories,
    averageHr: avgHr ? Math.round(avgHr * 10) / 10 : null,
    maxHr,
    averageCadence: avgCadence ? Math.round(avgCadence) : null,
    averagePower: avgPower ? Math.round(avgPower) : null,
    intensity,
    trigger,
  };
}

// ─── Main parsing functions ─────────────────────────────────

function parseGpx(xml: string): ParsedFileActivity | null {
  const nameFromXml = getTagContent(xml, "name");
  const trkContent = getTagContent(xml, "trk") || xml;

  // Extract all trackpoints
  const trkptRegex = /<trkpt[^>]*lat="([^"]*)"[^>]*lon="([^"]*)"[^>]*>([\s\S]*?)<\/trkpt>/g;
  const points: TrackPoint[] = [];
  let match;

  while ((match = trkptRegex.exec(trkContent)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    const inner = match[3];

    // Extensions
    const extensions = getTagContent(inner, "extensions");

    points.push({
      lat, lon,
      ele: parseFloatOrNull(getTagContent(inner, "ele")),
      time: getTagContent(inner, "time"),
      hr: getExtensionValue(inner, "hr") || parseFloatOrNull(getTagContent(inner, "hr")),
      cadence: extensions ? getExtensionValue(extensions, "cad") : null,
      power: null, // GPX rarely has power
      distance: null,
      speed: null,
    });
  }

  const base = computeFromPoints(points, nameFromXml || "GPX Import", []);
  if (!base) return null;

  // If no <name> was in the XML, generate a descriptive name from available data
  if (!nameFromXml) {
    base.name = generateBaseName(base.type, base.subType, base.startDate);
  }

  return base;
}

function parseTcx(xml: string): ParsedFileActivity | null {
  const sport = getAttr(xml, "Activity", "Sport") || "Other";

  // Try to get the activity name from <Notes> or <Name> in the Activity
  const activityXml = getTagContent(xml, "Activity") || xml;
  const nameFromNotes = getTagContent(activityXml, "Notes");
  const nameFromId = getTagContent(activityXml, "Id");
  const hasXmlName = !!(nameFromNotes || nameFromId);
  const name = nameFromNotes || nameFromId || `${sport} — TCX Import`;

  // Parse laps
  const lapContents = getTagContentAll(xml, "Lap");
  const laps: LapData[] = [];
  let totalTime = 0;
  let lapDistance = 0;
  let totalCalories = 0;
  let allTrackPoints: TrackPoint[] = [];

  for (const lapXml of lapContents) {
    const lap = parseLap(lapXml);
    laps.push(lap);
    totalTime += lap.totalTimeSeconds;
    if (lap.distanceMeters) lapDistance += lap.distanceMeters;
    if (lap.calories) totalCalories += lap.calories;

    // Extract trackpoints from this lap
    const tpContents = getTagContentAll(lapXml, "Trackpoint");
    for (const tp of tpContents) {
      const posXml = getTagContent(tp, "Position");
      let plat: number | null = null;
      let plon: number | null = null;
      if (posXml) {
        plat = parseFloatOrNull(getTagContent(posXml, "LatitudeDegrees"));
        plon = parseFloatOrNull(getTagContent(posXml, "LongitudeDegrees"));
      }

      const extensions = getTagContent(tp, "Extensions");

      allTrackPoints.push({
        lat: plat,
        lon: plon,
        ele: parseFloatOrNull(getTagContent(tp, "AltitudeMeters")),
        time: getTagContent(tp, "Time"),
        hr: parseFloatOrNull(getTagContent(getTagContent(tp, "HeartRateBpm") || "", "Value")),
        cadence: parseFloatOrNull(getTagContent(tp, "Cadence")) ||
                 (extensions ? getExtensionValue(extensions, "Cadence") ?? getExtensionValue(extensions, "RunCadence") : null),
        power: extensions ? getExtensionValue(extensions, "Watts") : null,
        distance: parseFloatOrNull(getTagContent(tp, "DistanceMeters")),
        speed: extensions ? getExtensionValue(extensions, "Speed") : null,
      });
    }
  }

  // If no laps found, try top-level extraction
  if (lapContents.length === 0) {
    totalTime = parseFloat(getTagContent(xml, "TotalTimeSeconds") || "0");
    const d = parseFloatOrNull(getTagContent(xml, "DistanceMeters"));
    if (d) lapDistance = d;

    const tpContents = getTagContentAll(xml, "Trackpoint");
    for (const tp of tpContents) {
      const posXml = getTagContent(tp, "Position");
      let plat: number | null = null;
      let plon: number | null = null;
      if (posXml) {
        plat = parseFloatOrNull(getTagContent(posXml, "LatitudeDegrees"));
        plon = parseFloatOrNull(getTagContent(posXml, "LongitudeDegrees"));
      }

      const extensions = getTagContent(tp, "Extensions");

      allTrackPoints.push({
        lat: plat,
        lon: plon,
        ele: parseFloatOrNull(getTagContent(tp, "AltitudeMeters")),
        time: getTagContent(tp, "Time"),
        hr: parseFloatOrNull(getTagContent(getTagContent(tp, "HeartRateBpm") || "", "Value")),
        cadence: parseFloatOrNull(getTagContent(tp, "Cadence")) ||
                 (extensions ? getExtensionValue(extensions, "Cadence") ?? getExtensionValue(extensions, "RunCadence") : null),
        power: extensions ? getExtensionValue(extensions, "Watts") : null,
        distance: parseFloatOrNull(getTagContent(tp, "DistanceMeters")),
        speed: extensions ? getExtensionValue(extensions, "Speed") : null,
      });
    }
  }

  const base = computeFromPoints(allTrackPoints, name, laps);
  if (!base) return null;

  // TCX has accurate lap-level data — prefer it over point calculations
  if (totalTime > 0) base.durationSeconds = Math.round(totalTime);
  if (lapDistance > 0) base.distanceMeters = Math.round(lapDistance);
  if (totalCalories > 0) base.calories = Math.round(totalCalories);

  // Aggregate HR from laps if available (more accurate than trackpoint-derived)
  const lapAvgHrs = laps.map(l => l.averageHr).filter(Boolean) as number[];
  if (lapAvgHrs.length > 0) {
    // Weight by lap duration
    let weightedHr = 0;
    let totalLapTime = 0;
    for (const lap of laps) {
      if (lap.averageHr && lap.totalTimeSeconds > 0) {
        weightedHr += lap.averageHr * lap.totalTimeSeconds;
        totalLapTime += lap.totalTimeSeconds;
      }
    }
    if (totalLapTime > 0) {
      base.averageHr = Math.round((weightedHr / totalLapTime) * 10) / 10;
    }
  }

  // Lap max HR
  const lapMaxHrs = laps.map(l => l.maxHr).filter(Boolean) as number[];
  if (lapMaxHrs.length > 0) {
    base.maxHr = Math.max(...lapMaxHrs);
  }

  // Power from lap extensions
  const lapPowers = laps.map(l => l.averagePower).filter(Boolean) as number[];
  if (lapPowers.length > 0) {
    const avgPower = lapPowers.reduce((a, b) => a + b, 0) / lapPowers.length;
    base.averagePower = Math.round(avgPower);
  }

  // Cadence from lap data
  const lapCadences = laps.map(l => l.averageCadence).filter(Boolean) as number[];
  if (lapCadences.length > 0) {
    const avgCad = lapCadences.reduce((a, b) => a + b, 0) / lapCadences.length;
    base.averageCadence = Math.round(avgCad);
  }

  // If no <Notes> or <Id> was in the TCX, generate a descriptive name from available data
  if (!hasXmlName) {
    base.name = generateBaseName(base.type, base.subType, base.startDate);
  }

  base.laps = laps;

  return base;
}

function computeFromPoints(points: TrackPoint[], name: string, laps: LapData[]): ParsedFileActivity | null {
  if (points.length < 2) return null;

  // Compute distance using Haversine
  let totalDistance = 0;
  let totalElevationGain = 0;
  const hrValues: number[] = [];
  const cadenceValues: number[] = [];
  const powerValues: number[] = [];
  let hasGps = false;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    if (prev.lat != null && prev.lon != null && curr.lat != null && curr.lon != null) {
      totalDistance += haversine(prev.lat, prev.lon, curr.lat, curr.lon);
      hasGps = true;
    } else if (prev.distance != null && curr.distance != null) {
      totalDistance = Math.max(totalDistance, curr.distance);
    }

    if (prev.ele && curr.ele && curr.ele > prev.ele) {
      totalElevationGain += curr.ele - prev.ele;
    }

    if (curr.hr) hrValues.push(curr.hr);
    if (curr.cadence) cadenceValues.push(curr.cadence);
    if (curr.power) powerValues.push(curr.power);
  }

  const firstTime = points[0].time ? new Date(points[0].time as string) : null;
  const lastTime = points[points.length - 1].time ? new Date(points[points.length - 1].time as string) : null;
  const durationSeconds = firstTime && lastTime
    ? Math.round((lastTime.getTime() - firstTime.getTime()) / 1000)
    : 0;

  const avgHr = hrValues.length > 0
    ? Math.round((hrValues.reduce((a, b) => a + b, 0) / hrValues.length) * 10) / 10
    : null;

  const maxHr = hrValues.length > 0 ? Math.max(...hrValues) : null;

  // Cadence
  const avgCadence = cadenceValues.length > 0
    ? Math.round(cadenceValues.reduce((a, b) => a + b, 0) / cadenceValues.length)
    : null;
  const maxCadence = cadenceValues.length > 0 ? Math.max(...cadenceValues) : null;

  // Power
  const avgPower = powerValues.length > 0
    ? Math.round(powerValues.reduce((a, b) => a + b, 0) / powerValues.length)
    : null;
  const maxPower = powerValues.length > 0 ? Math.max(...powerValues) : null;

  // Normalized Power® (NP): 4th root of the mean of the 4th powers over 30s rolling averages
  const normalizedPower = computeNormalizedPower(powerValues);

  // TSS estimate
  let tss: number | null = null;
  if (normalizedPower && avgPower && avgPower > 0) {
    // Cycling TSS: uses avgPower as FTP proxy
    tss = computePowerTss(durationSeconds, normalizedPower, avgPower);
  } else if (avgHr && maxHr && maxHr > 0) {
    // HR-based TSS
    tss = computeHrTssEstimate(durationSeconds, avgHr, maxHr);
  } else {
    tss = estimateTss(durationSeconds);
  }

  // Cap per-activity TSS to prevent absurd values from ultra-long efforts
  tss = Math.min(tss, 500);

  const { type: sportType, subType: sportSubType } = inferFromName(name);

  return {
    name,
    type: sportType,
    subType: sportSubType ?? null,
    startDate: firstTime || new Date(),
    durationSeconds,
    distanceMeters: totalDistance > 0 ? Math.round(totalDistance) : null,
    elevationGainMeters: totalElevationGain > 0 ? Math.round(totalElevationGain) : null,
    averageHr: avgHr,
    maxHr,
    averagePower: avgPower,
    maxPower,
    normalizedPower,
    averageCadence: avgCadence,
    maxCadence,
    calories: null,
    tss,
    description: null,
    trackPoints: points,
    laps,
  };
}

// Mapping moved to shared module: src/lib/sport-mappings.ts
// Use inferFromName() instead of mapGpxType/mapGpxSubType directly.

/** Detect file type and parse accordingly.
 */
export function parseActivityFile(content: string, filename: string): ParsedFileActivity | null {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".tcx")) {
    return parseTcx(content);
  }

  if (lower.endsWith(".gpx")) {
    return parseGpx(content);
  }

  // Try auto-detect by content
  if (content.includes("<TrainingCenterDatabase")) {
    return parseTcx(content);
  }
  if (content.includes("<gpx")) {
    return parseGpx(content);
  }

  return null;
}

/**
 * Generate a GPX 1.1 XML string from track points and activity metadata.
 * Used for exporting/downloading activities that were stored in the DB.
 */
export function generateGpxXml(
  trackPoints: TrackPoint[],
  activityName: string,
  startTime?: string | null,
): string {
  const validPoints = trackPoints.filter(tp => tp.lat != null && tp.lon != null);
  const gpxNs = "http://www.topografix.com/GPX/1/1";

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="coach-cj"
  xmlns="${gpxNs}"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata>
    <name>${escapeXml(activityName)}</name>`;

  if (startTime) {
    xml += `
    <time>${escapeXml(startTime)}</time>`;
  }

  xml += `
  </metadata>
  <trk>
    <name>${escapeXml(activityName)}</name>
    <trkseg>`;

  for (const tp of validPoints) {
    xml += `
      <trkpt lat="${tp.lat}" lon="${tp.lon}">`;
    if (tp.ele != null) {
      xml += `
        <ele>${tp.ele}</ele>`;
    }
    xml += `
      </trkpt>`;
  }

  xml += `
    </trkseg>
  </trk>
</gpx>`;

  return xml;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build the rawJson payload for DB storage from parsed activity.
 */
export function buildRawJson(activity: ParsedFileActivity, sourceFile: string): Record<string, unknown> {
  const lower = sourceFile.toLowerCase();
  const fileType = lower.endsWith(".tcx") ? "tcx"
    : lower.endsWith(".gpx") ? "gpx"
    : (lower.endsWith(".fit") || lower.endsWith(".fit.gz")) ? "fit"
    : "unknown";

  // Keep trackpoints with data — strip completely null entries at the tail
  const trackPoints = activity.trackPoints.filter(tp =>
    tp.lat != null || tp.lon != null || tp.hr != null || tp.cadence != null ||
    tp.power != null || tp.ele != null || tp.distance != null
  );

  return {
    trackPoints,
    laps: activity.laps,
    source: fileType,
    sourceFile,
    computedMetrics: {
      normalizedPower: activity.normalizedPower,
      tss: activity.tss,
      averageCadence: activity.averageCadence,
      maxCadence: activity.maxCadence,
    },
  };
}
