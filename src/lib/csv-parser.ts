/**
 * Parses Strava bulk export CSV (activities.csv from the ZIP download).
 *
 * Strava CSV column variations (they change over time):
 *   Activity ID, Activity Date, Activity Name, Activity Type,
 *   Elapsed Time, Moving Time, Distance, Distance.1,
 *   Elevation Gain, Elevation Loss, Elevation Low, Elevation High,
 *   Average Heart Rate, Max Heart Rate, Calories,
 *   Average Watts, Max Watts, ...
 */
import { ActivityType, ActivitySource } from "@prisma/client";

export interface ParsedCsvActivity {
  externalId: string;
  source: ActivitySource;
  type: ActivityType;
  name: string;
  description: string | null;
  startDate: Date;
  durationSeconds: number;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  averageHr: number | null;
  maxHr: number | null;
  averagePower: number | null;
  calories: number | null;
  tss: number | null;
}

export interface CsvParseResult {
  activities: ParsedCsvActivity[];
  errors: string[];
  totalRows: number;
  headers: string[];
}

const TYPE_MAP: Record<string, ActivityType> = {
  "Run": "run", "TrailRun": "run", "Trail Run": "run", "Ride": "ride", "VirtualRide": "ride", "Virtual Ride": "ride",
  "Swim": "swim", "Hike": "hike", "Walk": "walk", "Workout": "workout",
  "WeightTraining": "workout", "Weight Training": "workout", "Yoga": "workout", "Other": "other",
  "Rock Climbing": "other", "Surfing": "other", "Stand Up Paddling": "other",
  "Kayaking": "other", "Canoeing": "other", "Rowing": "other",
  "Crossfit": "workout", "Elliptical": "workout", "StairStepper": "workout",
  "Ice Skating": "other", "Inline Skating": "other", "Nordic Ski": "other",
  "Alpine Ski": "other", "Backcountry Ski": "other", "Snowboard": "other",
  "Snowshoe": "other", "Soccer": "other", "Tennis": "other", "Golf": "other",
  "Wheelchair": "other", "Handcycle": "ride",
};

// Flexible column finder — case-insensitive, trims, handles ".1" duplicates
function findCol(header: string[], ...names: string[]): number {
  for (const name of names) {
    // Exact match
    let idx = header.indexOf(name);
    if (idx >= 0) return idx;
    // Case-insensitive
    idx = header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    if (idx >= 0) return idx;
    // Partial match (contains)
    idx = header.findIndex((h) => h.toLowerCase().includes(name.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseNum(raw: string): number | null {
  if (!raw || raw.trim() === "") return null;
  const n = parseFloat(raw.trim());
  return isNaN(n) ? null : n;
}

function parseDate(raw: string): Date | null {
  if (!raw || raw.trim() === "") return null;
  const trimmed = raw.trim();
  // Try ISO format: 2024-01-15 or 2024-01-15T06:30:00Z
  let d = new Date(trimmed);
  if (!isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2100) return d;
  // Try MM/DD/YYYY or DD/MM/YYYY
  const parts = trimmed.split(/[\/\-.\s]/);
  if (parts.length === 3) {
    const a = parseInt(parts[0]), b = parseInt(parts[1]), c = parseInt(parts[2]);
    // Assume MM/DD/YYYY if a <= 12
    if (a <= 12 && b <= 31 && c > 2000) {
      d = new Date(c, a - 1, b);
      if (!isNaN(d.getTime())) return d;
    }
    // Assume YYYY-MM-DD
    if (a > 2000 && b <= 12 && c <= 31) {
      d = new Date(a, b - 1, c);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

// Parse a CSV row, respecting quoted fields that may contain commas.
// Handles escaped quotes ("") inside quoted fields.
function parseCsvRow(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote inside a quoted field
        current += '"';
        i++; // skip next char
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cols.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}

// Parse entire CSV content into rows, handling multi-line quoted fields
function parseCsvRows(content: string): string[] {
  const rows: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"') {
      if (inQuotes && content[i + 1] === '"') {
        current += '""'; i++;
      } else {
        inQuotes = !inQuotes;
      }
      current += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (current.trim()) rows.push(current.trim());
      current = "";
      // Skip \n after \r
      if (ch === "\r" && content[i + 1] === "\n") i++;
    } else {
      current += ch;
    }
  }
  if (current.trim()) rows.push(current.trim());
  return rows;
}

export function parseStravaCsv(content: string): CsvParseResult {
  // Strip BOM
  const clean = content.replace(/^﻿/, "");
  const rows = parseCsvRows(clean);

  if (rows.length < 2) {
    return { activities: [], errors: ["CSV file is empty"], totalRows: 0, headers: [] };
  }

  const header = parseCsvRow(rows[0]);

  const idIdx = findCol(header, "Activity ID");
  const dateIdx = findCol(header, "Activity Date");
  const nameIdx = findCol(header, "Activity Name");
  const typeIdx = findCol(header, "Activity Type");
  const movingIdx = findCol(header, "Moving Time");
  const elapsedIdx = findCol(header, "Elapsed Time");
  const distIdx = findCol(header, "Distance", "Distance.1");
  const elevIdx = findCol(header, "Elevation Gain");
  const avgHrIdx = findCol(header, "Average Heart Rate");
  const maxHrIdx = findCol(header, "Max Heart Rate");
  const powerIdx = findCol(header, "Average Watts", "Weighted Average Power");
  const calIdx = findCol(header, "Calories");
  const descIdx = findCol(header, "Activity Description");

  if (dateIdx < 0) {
    return {
      activities: [], errors: [
        `Could not find 'Activity Date' column. Headers found: ${header.join(", ")}`
      ], totalRows: rows.length - 1, headers: header,
    };
  }

  const activities: ParsedCsvActivity[] = [];
  const errors: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    try {
      const cols = parseCsvRow(rows[i]);

      const rawDate = cols[dateIdx];
      const date = parseDate(rawDate);
      if (!date) {
        errors.push(`Row ${i + 1}: invalid date "${rawDate}" — skipping`);
        continue;
      }

      const rawType = typeIdx >= 0 ? cols[typeIdx] : "Other";
      const type = TYPE_MAP[rawType] || "other";

      // Duration: prefer Moving Time, fall back to Elapsed Time
      let durationSec = 0;
      if (movingIdx >= 0) durationSec = Math.round(parseNum(cols[movingIdx]) || 0);
      if (durationSec === 0 && elapsedIdx >= 0) durationSec = Math.round(parseNum(cols[elapsedIdx]) || 0);
      if (durationSec === 0) durationSec = 3600; // default 1h rather than 0

      // Distance: Strava CSV exports in km, convert to meters
      const distRaw = distIdx >= 0 ? parseNum(cols[distIdx]) : null;
      const distance = distRaw != null ? Math.round(distRaw * 1000) : null;

      const elevation = elevIdx >= 0 ? parseNum(cols[elevIdx]) : null;
      const avgHr = avgHrIdx >= 0 ? parseNum(cols[avgHrIdx]) : null;
      const maxHr = maxHrIdx >= 0 ? parseNum(cols[maxHrIdx]) : null;
      const power = powerIdx >= 0 ? parseNum(cols[powerIdx]) : null;
      const calories = calIdx >= 0 ? parseNum(cols[calIdx]) : null;

      // TSS estimate
      const hours = durationSec / 3600;
      let tss: number | null = null;
      if (avgHr && maxHr && (type === "run" || type === "ride")) {
        const intensity = avgHr / maxHr;
        tss = Math.round((durationSec * intensity * intensity) / 36);
      } else {
        tss = Math.round(hours * 50);
      }

      activities.push({
        externalId: idIdx >= 0 ? cols[idIdx] : `csv-${i}`,
        source: "manual" as ActivitySource,
        type,
        name: nameIdx >= 0 ? cols[nameIdx] || "Untitled" : "Untitled",
        description: descIdx >= 0 ? cols[descIdx] || null : null,
        startDate: date,
        durationSeconds: durationSec,
        distanceMeters: distance,
        elevationGainMeters: elevation,
        averageHr: avgHr,
        maxHr,
        averagePower: power,
        calories,
        tss,
      });
    } catch (err) {
      errors.push(`Row ${i + 1}: ${(err as Error).message}`);
    }
  }

  return { activities, errors, totalRows: rows.length - 1, headers: header };
}
