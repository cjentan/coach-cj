/**
 * Parses a Strava data export ZIP file.
 *
 * The ZIP from strava.com → Settings → My Account → Download or Delete Your Account
 * contains activities.csv plus individual .gpx/.tcx/.fit files named by activity ID.
 *
 * We correlate CSV rows with their activity files to produce enriched activities
 * with full trackpoint data (GPS, HR, power, cadence).
 */
import AdmZip from "adm-zip";
import { parseStravaCsv, ParsedCsvActivity } from "./csv-parser";
import { parseActivityFile, buildRawJson, ParsedFileActivity } from "./gpx-parser";
import { parseFitFile } from "./fit-parser";

export interface StravaExportResult {
  /** Only populated when onActivity callback is NOT provided */
  activities: StravaExportActivity[];
  errors: string[];
  totalCsvRows: number;
  withRichData: number;
  csvOnly: number;
}

export interface StravaExportActivity extends ParsedCsvActivity {
  rawJson: Record<string, unknown> | null;
  hasRichData: boolean;
  normalizedPower: number | null;
}

export type ActivityCallback = (activity: StravaExportActivity) => Promise<void>;

// Matches files named by activity ID under any directory depth.
// Examples: activities/123456.gpx, 12345678.tcx, some/deep/path/98765.fit
// Capture group 1 = everything before the extension (used as the ID)
// Capture group 2 = the extension
const ACTIVITY_FILE_GLOBAL_RE = /(^|\/)(\d{4,})\.(gpx|tcx|fit)(\.gz)?$/i;

export async function parseStravaExportZip(
  zipBuffer: Buffer,
  onProgress?: (msg: string) => void,
  onActivity?: ActivityCallback,
): Promise<StravaExportResult> {
  const log = (msg: string) => {
    console.log(`[import:parse] ${msg}`);
    onProgress?.(msg);
  };

  const errors: string[] = [];
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  log(`ZIP opened: ${entries.length} entries total`);

  // ── Diagnostic: extension & directory breakdown ─────────
  const extCounts = new Map<string, number>();
  const dirCounts = new Map<string, number>();
  const nonMatchingSamples: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "(none)";
    extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
    const topDir = name.includes("/") ? name.split("/")[0] : "(root)";
    dirCounts.set(topDir, (dirCounts.get(topDir) || 0) + 1);
  }

  log(`File types in ZIP: ${Array.from(extCounts.entries()).map(([ext, n]) => `${ext}×${n}`).join(", ")}`);
  log(`Top-level dirs: ${Array.from(dirCounts.entries()).map(([d, n]) => `${d}/ (${n} files)`).join(", ")}`);

  // ── 1. Find activities.csv ──────────────────────────────
  let csvContent: string | null = null;
  for (const entry of entries) {
    const name = entry.entryName.toLowerCase();
    if (name === "activities.csv" || name.endsWith("/activities.csv")) {
      csvContent = entry.getData().toString("utf-8");
      log(`Found activities.csv (${(csvContent.length / 1024).toFixed(1)} KB)`);
      break;
    }
  }

  if (!csvContent) {
    return {
      activities: [],
      errors: ["No activities.csv found in the ZIP"],
      totalCsvRows: 0,
      withRichData: 0,
      csvOnly: 0,
    };
  }

  const csvResult = parseStravaCsv(csvContent);
  errors.push(...csvResult.errors);

  log(`CSV parsed: ${csvResult.activities.length} activities from ${csvResult.totalRows} rows` +
    (csvResult.errors.length > 0 ? ` (${csvResult.errors.length} parse warnings)` : ""));

  if (csvResult.activities.length === 0) {
    return {
      activities: [],
      errors,
      totalCsvRows: csvResult.totalRows,
      withRichData: 0,
      csvOnly: 0,
    };
  }

  // ── Diagnostic: CSV ID + Filename samples ──────────────
  const csvIdSamples = csvResult.activities.slice(0, 5).map(a => a.externalId);
  log(`CSV activity ID samples: ${csvIdSamples.join(", ")}`);
  const csvFnSamples = csvResult.activities.slice(0, 5).map(a => a.filename || "(none)");
  log(`CSV filename samples: ${csvFnSamples.join(", ")}`);

  // ── 2. Build lookup of activity files by ID ─────────────
  // Match ANY file that looks like an activity file (numeric name + gpx/tcx/fit),
  // regardless of directory depth. Also handles .fit.gz compressed files.
  const filesById = new Map<string, { name: string; buffer: Buffer }>();
  let fileCount = 0;
  let fitGzCount = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;

    const match = name.match(ACTIVITY_FILE_GLOBAL_RE);
    if (match) {
      const id = match[2];          // the numeric activity ID
      const ext = match[3].toLowerCase();
      const isGz = match[4] === ".gz";

      if (!filesById.has(id)) {
        if (isGz) {
          fitGzCount++;
        }
        filesById.set(id, { name, buffer: entry.getData() });
        fileCount++;
      }
    } else if (name.match(/\.(gpx|tcx|fit)(\.gz)?$/i)) {
      // File has a matching extension but non-numeric ID — collect samples for diagnostics
      if (nonMatchingSamples.length < 10) {
        nonMatchingSamples.push(name);
      }
    }

    if (fileCount > 0 && fileCount % 100 === 0) {
      log(`Indexing activity files: ${fileCount} found so far…`);
    }
  }

  log(`Indexed ${fileCount} activity files from ZIP${fitGzCount > 0 ? ` (${fitGzCount} .fit.gz compressed)` : ""}`);

  // ── Diagnostic: show unmatched activity files ───────────
  if (nonMatchingSamples.length > 0) {
    log(`Non-numeric activity file samples: ${nonMatchingSamples.join(", ")}`);
  }

  // Show file ID samples
  const fileIdSamples = Array.from(filesById.keys()).slice(0, 5);
  if (fileIdSamples.length > 0) {
    log(`File ID samples from ZIP: ${fileIdSamples.join(", ")}`);
  }

  // ── Diagnostic: check overlap ───────────────────────────
  const csvIdLookup = new Map<string, boolean>();
  for (const a of csvResult.activities) csvIdLookup.set(a.externalId, true);
  // Also check by Filename column
  let fnMatchCount = 0;
  let fnLookupFailures = 0;
  for (const a of csvResult.activities) {
    if (a.filename) {
      const m = a.filename.match(/(\d{4,})\./);
      if (m && filesById.has(m[1])) fnMatchCount++;
      else if (m) fnLookupFailures++;
    }
  }
  const fileIdKeys: string[] = [];
  filesById.forEach((_, k) => fileIdKeys.push(k));
  let matchCount = 0;
  csvIdLookup.forEach((_, cid) => {
    if (filesById.has(cid)) matchCount++;
  });
  const unmatchedFileIds = fileIdKeys.filter(fid => !csvIdLookup.has(fid));
  log(`CSV-to-file match rate (by Activity ID): ${matchCount} of ${csvIdLookup.size}`);
  log(`CSV-to-file match rate (by Filename column): ${fnMatchCount} matched, ${fnLookupFailures} looked up but not found in ZIP`);
  log(`File ID samples from ZIP: ${fileIdKeys.slice(0, 5).join(", ")}`);

  // ── 3. Correlate and parse ──────────────────────────────
  const activities: StravaExportActivity[] = [];
  let withRichData = 0;
  let csvOnly = 0;
  const total = csvResult.activities.length;

  for (let i = 0; i < csvResult.activities.length; i++) {
    const csvRow = csvResult.activities[i];
    let rawJson: Record<string, unknown> | null = null;
    let hasRichData = false;
    let fileActivity: ParsedFileActivity | null = null;

    try {
      // Use the Filename column from CSV (e.g. "activities/20345958602.fit.gz")
      // to derive the file ID, since the CSV Activity ID often differs from
      // the file's numeric ID in the Strava export.
      let fileId: string | null = null;
      if (csvRow.filename) {
        // Extract numeric ID from "activities/20345958602.fit.gz"
        const fnMatch = csvRow.filename.match(/(\d{4,})\./);
        if (fnMatch) fileId = fnMatch[1];
      }
      // Fall back to the CSV Activity ID if no filename column matched
      const fileMatch = filesById.get(fileId || csvRow.externalId);

      if (fileMatch) {
        const lower = fileMatch.name.toLowerCase();
        const isGz = lower.endsWith(".gz");

        if (lower.endsWith(".fit") || lower.endsWith(".fit.gz")) {
          try {
            let fitBuffer = fileMatch.buffer;
            // Decompress .fit.gz files
            if (isGz) {
              const zlib = await import("zlib");
              fitBuffer = zlib.gunzipSync(fileMatch.buffer);
            }
            const fitActivities = await parseFitFile(fitBuffer);
            if (fitActivities.length > 0) {
              fileActivity = fitActivities[0];
            }
          } catch (err) {
            const msg = `Failed to parse FIT ${fileMatch.name}: ${(err as Error).message}`;
            errors.push(msg);
            console.error(`[import:parse] ${msg}`);
          }
        } else {
          try {
            let content: string;
            if (isGz) {
              const zlib = await import("zlib");
              content = zlib.gunzipSync(fileMatch.buffer).toString("utf-8");
            } else {
              content = fileMatch.buffer.toString("utf-8");
            }
            fileActivity = parseActivityFile(content, fileMatch.name);
          } catch (err) {
            const msg = `Failed to parse ${fileMatch.name}: ${(err as Error).message}`;
            errors.push(msg);
            console.error(`[import:parse] ${msg}`);
          }
        }

        if (fileActivity) {
          rawJson = buildRawJson(fileActivity, fileMatch.name);
          hasRichData = true;
        }
      }

      // Merge: file track data enriches the CSV row
      const activity: StravaExportActivity = {
        ...csvRow,
        rawJson,
        hasRichData,
        normalizedPower: fileActivity?.normalizedPower ?? null,
        maxHr: fileActivity?.maxHr ?? csvRow.maxHr ?? null,
      };

      // Override type with file-detected type if CSV type is generic
      if (fileActivity && csvRow.type === "other") {
        activity.type = fileActivity.type;
      }

      if (onActivity) {
        await onActivity(activity);
      } else {
        activities.push(activity);
      }

      if (hasRichData) {
        withRichData++;
      } else {
        csvOnly++;
      }
    } catch (err) {
      const msg = `Unexpected error processing activity ${csvRow.externalId} ("${csvRow.name}"): ${(err as Error).message}`;
      errors.push(msg);
      console.error(`[import:parse] ${msg}`);
      const fallback: StravaExportActivity = {
        ...csvRow,
        rawJson: null,
        hasRichData: false,
        normalizedPower: null,
      };
      if (onActivity) {
        await onActivity(fallback);
      } else {
        activities.push(fallback);
      }
      csvOnly++;
    }

    // YIELD to the event loop so heartbeats fire and stream data flushes.
    if ((i + 1) % 5 === 0 || i === total - 1) {
      await new Promise((r) => setImmediate(r));
    }

    // Progress every 50 activities or on the last one
    if ((i + 1) % 50 === 0 || i === total - 1) {
      log(`Parsed ${i + 1}/${total} activities (${withRichData} with GPS data, ${csvOnly} CSV-only)`);
    }
  }

  return {
    activities,
    errors,
    totalCsvRows: csvResult.totalRows,
    withRichData,
    csvOnly,
  };
}
