"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistance, formatDuration } from "@/lib/utils";
import { format } from "date-fns";
import {
  Copy, CheckCircle, XCircle, AlertTriangle, RefreshCw, Loader2, ArrowRight,
  Activity, Clock, Route,
} from "lucide-react";

interface DuplicateActivity {
  id: string; source: string; type: string; name: string;
  startDate: string; durationSeconds: number; distanceMeters: number | null;
  elevationGainMeters: number | null; averageHr: number | null; tss: number | null;
  remarks: string | null; mergedIntoId: string | null; duplicateStatus: string | null;
}

interface DuplicateGroup {
  id: string; status: string; keptActivityId: string | null;
  trainingLogs: DuplicateActivity[];
  createdAt: string;
}

const SOURCE_LABELS: Record<string, string> = {
  strava: "Strava",
  garmin: "Garmin",
  watch_push: "Watch Push",
  manual: "Manual",
};

const SOURCE_COLORS: Record<string, "default" | "secondary" | "outline" | "success" | "warning"> = {
  strava: "default",
  garmin: "success",
  watch_push: "warning",
  manual: "secondary",
};

export default function DuplicatesPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [error, setError] = useState("");
  // Track which activity is selected as the "keep" target per group
  const [selectedKeep, setSelectedKeep] = useState<Record<string, string>>({});

  async function loadGroups() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/duplicates/list?status=pending");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setGroups(data.groups || []);
    } catch (err) {
      setError(`Failed to load: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadGroups(); }, []);

  async function handleScan() {
    setScanning(true);
    setError("");
    try {
      const res = await fetch("/api/duplicates/detect?persist=true", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      await loadGroups();
      alert(data.message);
    } catch (err) {
      setError(`Scan failed: ${(err as Error).message}`);
    } finally {
      setScanning(false);
    }
  }

  async function handleMerge(groupId: string, keepActivityId: string) {
    setResolving(groupId);
    try {
      const res = await fetch("/api/duplicates/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, keepActivityId }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadGroups();
    } catch (err) {
      alert(`Merge failed: ${(err as Error).message}`);
    } finally {
      setResolving(null);
    }
  }

  async function handleDismiss(groupId: string) {
    setResolving(groupId);
    try {
      const res = await fetch("/api/duplicates/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, action: "dismiss" }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadGroups();
    } catch (err) {
      alert(`Dismiss failed: ${(err as Error).message}`);
    } finally {
      setResolving(null);
    }
  }

  async function handleResnapshot() {
    setSnapshotting(true);
    setSnapshotMessage(null);
    try {
      const res = await fetch("/api/duplicates/resnapshot", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSnapshotMessage({
        type: "success",
        text: data.message || `Re-snapshotted ${data.weeksSnapshotted} week(s).`,
      });
    } catch (err) {
      setSnapshotMessage({
        type: "error",
        text: `Re-snapshot failed: ${(err as Error).message}`,
      });
    } finally {
      setSnapshotting(false);
    }
  }

  // Determine default "keep" selection for a group
  function getDefaultKeep(group: DuplicateGroup): string {
    const active = group.trainingLogs.filter((a) => !a.mergedIntoId);
    if (active.length === 0) return "";
    const priority: Record<string, number> = { garmin: 0, watch_push: 1, strava: 2, manual: 3 };
    const sorted = [...active].sort((a, b) => {
      const pa = priority[a.source] ?? 99;
      const pb = priority[b.source] ?? 99;
      if (pa !== pb) return pa - pb;
      if (a.remarks && !b.remarks) return -1;
      if (!a.remarks && b.remarks) return 1;
      const aData = (a.tss ? 1 : 0) + (a.averageHr ? 1 : 0) + (a.distanceMeters ? 1 : 0);
      const bData = (b.tss ? 1 : 0) + (b.averageHr ? 1 : 0) + (b.distanceMeters ? 1 : 0);
      return bData - aData;
    });
    return sorted[0].id;
  }

  // Initialize default selections when groups load
  useEffect(() => {
    const defaults: Record<string, string> = {};
    for (const g of groups) {
      defaults[g.id] = selectedKeep[g.id] || getDefaultKeep(g);
    }
    setSelectedKeep((prev) => ({ ...prev, ...defaults }));
  }, [groups]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Copy className="h-6 w-6 text-primary" /> Duplicate Activities
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Detect and resolve duplicate activities from different sources
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResnapshot}
            disabled={snapshotting}
            className="w-full sm:w-auto"
          >
            {snapshotting ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Resnapshotting...</>
            ) : (
              <><Activity className="h-4 w-4 mr-2" /> Re-snapshot Trends</>
            )}
          </Button>
          <Button onClick={handleScan} disabled={scanning} className="w-full sm:w-auto">
            {scanning ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scanning...</>
            ) : (
              <><RefreshCw className="h-4 w-4 mr-2" /> Scan for Duplicates</>
            )}
          </Button>
        </div>
      </div>

      {snapshotMessage && (
        <div className={`flex items-center gap-2 p-3 mb-4 rounded-md text-sm ${
          snapshotMessage.type === "success"
            ? "bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
            : "bg-destructive/10 border border-destructive/20 text-destructive"
        }`}>
          {snapshotMessage.type === "success" ? (
            <CheckCircle className="h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          {snapshotMessage.text}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-md bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin" />
          Loading...
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle className="h-12 w-12 mx-auto mb-3 text-green-500" />
            <h2 className="text-lg font-semibold mb-1">No Duplicates Found</h2>
            <p className="text-sm text-muted-foreground mb-4">
              No pending duplicate groups. Click &quot;Scan for Duplicates&quot; to check for new matches.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" onClick={handleScan} disabled={scanning}>
                <RefreshCw className="h-4 w-4 mr-2" /> Scan Now
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleResnapshot}
                disabled={snapshotting}
              >
                {snapshotting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Resnapshotting...</>
                ) : (
                  <><Activity className="h-4 w-4 mr-2" /> Re-snapshot Trends</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups
            .filter((g) => g.trainingLogs.length > 0)
            .map((group) => {
            const active = group.trainingLogs.filter((a) => !a.mergedIntoId);
            const keepId = selectedKeep[group.id] || getDefaultKeep(group);
            const keepActivity = active.find((a) => a.id === keepId);

            return (
              <Card key={group.id} className="border-amber-200 dark:border-amber-800">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      Potential Duplicate Group
                    </CardTitle>
                    <Badge variant="warning" className="text-[10px]">
                      {active.length} activities
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* All activities — click to select which to keep */}
                  <div className="space-y-2">
                    {active.map((activity) => {
                      const isSelected = activity.id === keepId;
                      return (
                        <button
                          key={activity.id}
                          onClick={() => setSelectedKeep((prev) => ({ ...prev, [group.id]: activity.id }))}
                          className={`w-full text-left rounded-lg p-3 border-2 transition-all ${
                            isSelected
                              ? "border-green-500 bg-green-50 dark:bg-green-950"
                              : "border-border bg-muted/30 hover:border-muted-foreground/40"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            {isSelected && (
                              <Badge variant="success" className="text-[10px] shrink-0">Keep</Badge>
                            )}
                            <span className={`text-xs font-medium ${isSelected ? "text-green-700 dark:text-green-300" : "text-muted-foreground"}`}>
                              {isSelected ? "Selected — click another to change" : "Click to keep this one"}
                            </span>
                          </div>
                          <ActivityRow
                            activity={activity}
                            isSelected={isSelected}
                          />
                        </button>
                      );
                    })}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-4 pt-3 border-t">
                    {keepActivity && (
                      <Button
                        size="sm"
                        onClick={() => handleMerge(group.id, keepActivity.id)}
                        disabled={resolving === group.id}
                      >
                        {resolving === group.id ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <CheckCircle className="h-4 w-4 mr-1" />
                        )}
                        Merge {active.length - 1} others into &quot;{keepActivity.name}&quot;
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDismiss(group.id)}
                      disabled={resolving === group.id}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Not a duplicate
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ activity, isSelected }: { activity: DuplicateActivity; isSelected?: boolean }) {
  const pace = activity.distanceMeters && activity.distanceMeters > 0
    ? activity.distanceMeters / activity.durationSeconds
    : 0;

  const paceStr = pace > 0
    ? `${Math.floor(pace / 60)}:${String(Math.round(pace % 60)).padStart(2, "0")} /km`
    : "—";

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Badge variant={SOURCE_COLORS[activity.source] || "outline"} className="shrink-0">
        {SOURCE_LABELS[activity.source] || activity.source}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium truncate ${isSelected ? "text-green-700 dark:text-green-300" : ""}`}>
            {activity.name}
          </span>
          <Badge variant="outline" className="text-[10px] shrink-0">{activity.type}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
          <span>{format(new Date(activity.startDate), "MMM d, yyyy h:mm a")}</span>
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDuration(activity.durationSeconds)}</span>
          {activity.distanceMeters && (
            <span className="flex items-center gap-1"><Route className="h-3 w-3" />{formatDistance(activity.distanceMeters)}</span>
          )}
          {activity.tss && <span>TSS {Math.round(activity.tss)}</span>}
          {pace > 0 && <span>{paceStr}</span>}
        </div>
      </div>
      {activity.remarks && (
        <Badge variant="secondary" className="text-[10px] shrink-0">Has notes</Badge>
      )}
    </div>
  );
}
