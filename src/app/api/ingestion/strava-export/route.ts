/**
 * Strava Export ZIP ingestion — streaming endpoint with heartbeat.
 *
 * Returns an NDJSON stream (one JSON object per line) so the client
 * can render real-time progress logs. A heartbeat ping is sent every
 * 3 seconds during processing to keep proxies (Tailscale, nginx) from
 * killing the connection during long parsing phases.
 *
 * Event types:
 *   { type: "heartbeat", ts }
 *   { type: "progress", phase, message, current?, total?, imported?, enriched?, skipped? }
 *   { type: "activity", externalId, name, type, status, duration?, distance?, hasRichData?, error?, index }
 *   { type: "summary", imported, enriched, skipped, withRichData, csvOnly, totalCsvRows, errors, message }
 *   { type: "error",  message }
 *   { type: "done" }
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseStravaExportZip } from "@/lib/strava-export-parser";
import { generateActivityName, generateBaseName } from "@/lib/activity-naming";
import { TrackPoint } from "@/lib/gpx-parser";
import { snapshotWeek } from "@/lib/metrics-snapshot";
import { getWeekStart } from "@/lib/utils";

const HEARTBEAT_MS = 3000; // ping every 3 seconds to keep proxies alive

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }) + "\n",
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid form data" }) + "\n",
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return new Response(
      JSON.stringify({ error: "No file provided" }) + "\n",
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!file.name.toLowerCase().endsWith(".zip")) {
    return new Response(
      JSON.stringify({ error: "Please upload a .zip file from your Strava data export" }) + "\n",
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  console.log(`[import] Starting import: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, data: Record<string, unknown>) => {
    controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
  };

  const stream = new ReadableStream({
    async start(controller) {
      const s = (data: Record<string, unknown>) => send(controller, data);
      const log = (msg: string) => console.log(`[import] ${msg}`);

      // ── Heartbeat to keep proxies alive ──────────────
      const heartbeat = setInterval(() => {
        try {
          s({ type: "heartbeat", ts: Date.now() });
        } catch {
          // stream closed, stop heartbeat
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_MS);

      // ── Listen for client abort ────────────────────
      const onAbort = () => {
        clearInterval(heartbeat);
        try {
          s({ type: "error", message: "Import cancelled by user" });
          s({ type: "summary", imported: 0, enriched: 0, skipped: 0, withRichData: 0, csvOnly: 0, totalCsvRows: 0, errors: ["Import cancelled"], message: "Import stopped — user cancelled" });
          s({ type: "done" });
          controller.close();
        } catch {
          // stream already closed/cancelled
        }
      };

      req.signal.addEventListener("abort", onAbort);

      try {
        // ── Phase 1: Read & parse the ZIP ──────────────
        log("Phase 1: Reading ZIP file");
        s({ type: "progress", phase: "reading", message: "Reading ZIP file…" });

        let arrayBuffer: ArrayBuffer;
        try {
          arrayBuffer = await file.arrayBuffer();
          log(`ZIP loaded into memory: ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)} MB`);
        } catch (err) {
          log(`ERROR reading file: ${(err as Error).message}`);
          s({ type: "error", message: `Failed to read file: ${(err as Error).message}` });
          clearInterval(heartbeat);
          controller.close();
          return;
        }

        const zipBuffer = Buffer.from(arrayBuffer);
        s({
          type: "progress",
          phase: "parsing",
          message: `ZIP loaded (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)} MB). Extracting and parsing activities…`,
        });

        log("Phase 2: Parsing activities from ZIP + importing to DB");
        const startParse = Date.now();

        const userId = session.user.id;
        let imported = 0;
        let enriched = 0;
        let skipped = 0;
        const fileErrors: string[] = [];
        const affectedWeeks = new Set<string>();
        let totalCsvRows = 0;

        s({
          type: "progress",
          phase: "importing",
          message: "Parsing ZIP and importing to database…",
        });

        let result: import("@/lib/strava-export-parser").StravaExportResult;
        try {
          result = await parseStravaExportZip(
            zipBuffer,
            (msg: string) => {
              log(msg);
              s({ type: "progress", phase: "importing", message: msg });
            },
            async (activity) => {
              // If the user cancelled, skip processing
              if (req.signal.aborted) {
                return;
              }

              // Enrich default-named activities with area from GPS data.
              // If the activity name matches the default pattern (<TimeOfDay> <Type>)
              // or is "Untitled", prepend the area name just like all other ingestion modes
              // (gpx/route.ts, etc.) so the name reads "<Area> <TimeOfDay> <Type>".
              if (activity.hasRichData && activity.rawJson) {
                const defaultName = generateBaseName(activity.type, activity.subType, activity.startDate);
                if (activity.name === "Untitled" || activity.name === defaultName) {
                  try {
                    const points = (activity.rawJson as Record<string, unknown>).trackPoints as TrackPoint[] | undefined;
                    activity.name = await generateActivityName(
                      activity.type,
                      activity.subType,
                      activity.startDate,
                      points,
                    );
                  } catch {
                    // Keep existing name if area lookup fails
                  }
                }
              }

              try {
                const existing = await prisma.trainingLog.findFirst({
                  where: { userId, externalId: activity.externalId },
                });

                if (existing) {
                  if (existing.rawJson != null) {
                    skipped++;
                    return;
                  }

                  await prisma.trainingLog.update({
                    where: { id: existing.id },
                    data: {
                      source: "strava",
                      type: activity.type,
                      subType: activity.subType,
                      name: activity.name,
                      description: activity.description,
                      startDate: activity.startDate,
                      durationSeconds: activity.durationSeconds,
                      distanceMeters: activity.distanceMeters,
                      elevationGainMeters: activity.elevationGainMeters,
                      averageHr: activity.averageHr,
                      maxHr: activity.maxHr ?? existing.maxHr,
                      averagePower: activity.averagePower,
                      normalizedPower: activity.normalizedPower ?? existing.normalizedPower,
                      calories: activity.calories,
                      tss: activity.tss,
                      rawJson: activity.rawJson as any,
                    },
                  });

                  if (activity.hasRichData) enriched++;
                  affectedWeeks.add(getWeekStart(activity.startDate).toISOString());
                  imported++;
                } else {
                  await prisma.trainingLog.create({
                    data: {
                      userId,
                      externalId: activity.externalId,
                      source: "strava",
                      type: activity.type,
                      subType: activity.subType,
                      name: activity.name,
                      description: activity.description,
                      startDate: activity.startDate,
                      durationSeconds: activity.durationSeconds,
                      distanceMeters: activity.distanceMeters,
                      elevationGainMeters: activity.elevationGainMeters,
                      averageHr: activity.averageHr,
                      maxHr: activity.maxHr,
                      averagePower: activity.averagePower,
                      normalizedPower: activity.normalizedPower,
                      calories: activity.calories,
                      tss: activity.tss,
                      rawJson: activity.rawJson as any,
                    },
                  });
                  affectedWeeks.add(getWeekStart(activity.startDate).toISOString());
                  imported++;
                }

                s({
                  type: "activity",
                  externalId: activity.externalId,
                  name: activity.name,
                  activityType: activity.type,
                  status: existing ? (existing.rawJson ? "skipped" : "enriched") : "imported",
                  hasRichData: activity.hasRichData,
                  index: imported + enriched + skipped - 1,
                  total: totalCsvRows,
                });
              } catch (err) {
                const msg = `DB error for ${activity.externalId} ("${activity.name}"): ${(err as Error).message}`;
                fileErrors.push(msg);
                console.error(`[import] ${msg}`);
              }
            },
            req.signal,
          );
          totalCsvRows = result.totalCsvRows;
        } catch (err) {
          log(`ERROR parsing ZIP: ${(err as Error).message}`);
          console.error(`[import] Parse error:`, err);
          s({ type: "error", message: `Failed to parse ZIP: ${(err as Error).message}` });
          clearInterval(heartbeat);
          controller.close();
          return;
        }

        // If the user cancelled, skip remaining phases
        if (req.signal.aborted) {
          log("Import cancelled — skipping snapshot and summary");
          return;
        }

        const parseMs = Date.now() - startParse;
        log(`Import complete in ${(parseMs / 1000).toFixed(1)}s: ${imported} imported, ${enriched} enriched, ${skipped} skipped`);

        // ── Phase 4: Recompute weekly snapshots ────────
        if (affectedWeeks.size > 0) {
          log(`Phase 4: Snapshotting ${affectedWeeks.size} week(s)`);
          s({
            type: "progress",
            phase: "snapshotting",
            message: `Updating weekly snapshots for ${affectedWeeks.size} week(s)…`,
          });

          const weeks = Array.from(affectedWeeks);
          for (const weekKey of weeks) {
            await snapshotWeek(userId, new Date(weekKey)).catch((err) => {
              console.error(`[import] Snapshot error for ${weekKey}:`, err);
            });
          }
          log("Snapshots complete");
        }

        // ── Final summary (skip if cancelled) ──────────
        if (!req.signal.aborted) {
          s({
            type: "summary",
            imported,
            enriched,
            skipped,
            withRichData: result.withRichData,
            csvOnly: result.csvOnly,
            totalCsvRows: result.totalCsvRows,
            errors: [...result.errors, ...fileErrors].slice(0, 20),
            message: `Imported ${imported} activities (${result.withRichData} with full GPS/trackpoint data` +
              `${enriched > 0 ? `, ${enriched} upgraded from basic` : ""})` +
              `${skipped > 0 ? `, ${skipped} skipped` : ""}`,
          });
        }
      } catch (err) {
        console.error(`[import] Unexpected error:`, err);
        s({ type: "error", message: `Unexpected error: ${(err as Error).message}` });
      } finally {
        clearInterval(heartbeat);
        req.signal.removeEventListener("abort", onAbort);
        s({ type: "done" });
        try { controller.close(); } catch {}
        log("Stream closed");
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
