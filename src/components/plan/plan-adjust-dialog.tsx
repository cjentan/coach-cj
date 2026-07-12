"use client";

import { useState } from "react";
import { Wand2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { formatDistance } from "@/lib/utils";

interface PlannedSession {
  dayOfWeek: number;
  type: string;
  description: string;
  targetDistance: number | null;
  targetElevation: number | null;
  targetDuration: number;
  facility: string | null;
}

interface AdjustResult {
  weekStart: string;
  targetVolumeMeters: number;
  targetElevationMeters: number;
  targetDurationSeconds: number;
  plannedSessions: PlannedSession[];
  adjustments: string[];
  trajectoryAssessment: string | null;
  explanation: string;
  guardrailViolations: string[];
  fromCache: boolean;
  overridesExisting?: boolean;
}

interface PlanAdjustDialogProps {
  plan: {
    weekStart: string;
    targetVolumeMeters: number;
    targetElevationMeters: number;
    plannedSessions: PlannedSession[];
    adjustments: string[];
    trajectoryAssessment?: string;
    coachNotes?: string;
    fromCache?: boolean;
  };
  onApplied: (updatedPlan: {
    weekStart: string;
    targetVolumeMeters: number;
    targetElevationMeters: number;
    plannedSessions: PlannedSession[];
    adjustments: string[];
    trajectoryAssessment?: string;
    coachNotes?: string;
    fromCache?: boolean;
  }) => void;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function PlanAdjustDialog({ plan, onApplied }: PlanAdjustDialogProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AdjustResult | null>(null);

  async function handleSubmit() {
    if (!prompt.trim()) return;

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/dashboard/plan/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
        setLoading(false);
        return;
      }

      setResult(data);

      if (data.guardrailViolations && data.guardrailViolations.length > 0) {
        setError(
          `Some safety checks flagged: ${data.guardrailViolations.join("; ")}. The plan was adjusted but may need manual review.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }

    setLoading(false);
  }

  function handleApply() {
    if (!result) return;
    onApplied({
      weekStart: result.weekStart,
      targetVolumeMeters: result.targetVolumeMeters,
      targetElevationMeters: result.targetElevationMeters,
      plannedSessions: result.plannedSessions,
      adjustments: result.adjustments,
      trajectoryAssessment: result.trajectoryAssessment || "",
      fromCache: result.fromCache,
    });
    setOpen(false);
    setPrompt("");
    setResult(null);
  }

  function handleCancel() {
    setOpen(false);
    setPrompt("");
    setResult(null);
    setError("");
  }

  function sessionChanged(session: PlannedSession, idx: number): boolean {
    const original = plan.plannedSessions.find((s) => s.dayOfWeek === idx);
    if (!original) return session.type !== "rest";
    return (
      session.type !== original.type ||
      session.description !== original.description ||
      session.targetDistance !== original.targetDistance ||
      session.targetElevation !== original.targetElevation ||
      session.facility !== original.facility
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Wand2 className="h-4 w-4 mr-1" /> Modify Plan
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adjust Your Plan</DialogTitle>
          <DialogDescription>
            Describe what&apos;s changed this week and how the plan should adapt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Prompt input */}
          <div>
            <label htmlFor="adjust-prompt" className="text-sm font-medium">
              What changed?
            </label>
            <Textarea
              id="adjust-prompt"
              placeholder='"I&apos;ll be away for work Tue-Thu, no facilities"... "Down with flu, out 4 days"... "Feeling great, want more intensity"...'
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="mt-1.5"
              rows={3}
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
          </div>

          {/* Primary action button */}
          <Button
            onClick={handleSubmit}
            disabled={loading || !prompt.trim()}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Thinking...
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-2" />
                Adjust Plan
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            {loading ? "Analyzing your request..." : "⌘+Enter to submit"}
          </p>

          {/* Error */}
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Result preview */}
          {result && !loading && (
            <div className="space-y-3 border rounded-lg p-4 bg-muted/30">
              {/* Explanation */}
              <div>
                <p className="text-sm font-medium mb-2">📝 Changes</p>
                <p className="text-sm text-muted-foreground">{result.explanation}</p>
              </div>

              {/* Session diff */}
              <div>
                <p className="text-sm font-medium mb-2">Session Changes</p>
                <div className="space-y-1">
                  {result.plannedSessions
                    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
                    .map((session, idx) => {
                      const changed = sessionChanged(session, session.dayOfWeek);
                      const original = plan.plannedSessions.find(
                        (s) => s.dayOfWeek === session.dayOfWeek
                      );

                      if (session.type === "rest" && (!original || original.type === "rest")) {
                        // No change, both rest
                        return (
                          <div
                            key={session.dayOfWeek}
                            className="flex items-center gap-2 text-sm py-1 text-muted-foreground"
                          >
                            <span className="w-8 text-xs font-medium">{DAY_NAMES[session.dayOfWeek]}</span>
                            <span className="italic">Rest</span>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={session.dayOfWeek}
                          className={`flex items-center gap-2 text-sm py-1 rounded px-1 ${
                            changed ? "bg-primary/5" : ""
                          }`}
                        >
                          <span className="w-8 text-xs font-medium">
                            {DAY_NAMES[session.dayOfWeek]}
                          </span>

                          {original && changed ? (
                            <>
                              <span className="line-through text-muted-foreground text-xs">
                                {original.description}
                                {original.targetDistance
                                  ? ` ${Math.round(original.targetDistance / 1000)}km`
                                  : ""}
                              </span>
                              <span className="text-muted-foreground">→</span>
                            </>
                          ) : null}

                          <span className={`font-medium ${changed ? "" : ""}`}>
                            {session.description}
                          </span>

                          {session.targetDistance && (
                            <span className="text-xs text-muted-foreground">
                              {Math.round(session.targetDistance / 1000)}km
                            </span>
                          )}
                          {session.targetElevation && session.targetElevation > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {session.targetElevation}m
                            </span>
                          )}
                          {session.facility && (
                            <span className="text-xs text-muted-foreground ml-auto truncate max-w-[100px]">
                              {session.facility}
                            </span>
                          )}

                          {changed && (
                            <Badge variant="warning" className="text-xs ml-1 shrink-0">
                              changed
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Volume summary */}
              <div className="flex gap-4 text-xs text-muted-foreground pt-2 border-t">
                <span>
                  Volume: {Math.round(result.targetVolumeMeters / 1000)}km
                  {result.targetVolumeMeters !== plan.targetVolumeMeters && (
                    <span
                      className={
                        result.targetVolumeMeters > plan.targetVolumeMeters
                          ? "text-green-600"
                          : "text-red-600"
                      }
                    >
                      {" "}
                      ({result.targetVolumeMeters > plan.targetVolumeMeters ? "+" : ""}
                      {Math.round(
                        ((result.targetVolumeMeters - plan.targetVolumeMeters) /
                          plan.targetVolumeMeters) *
                          100
                      )}
                      %)
                    </span>
                  )}
                </span>
                <span>
                  Elevation: {formatDistance(result.targetElevationMeters)}
                  {result.targetElevationMeters !== plan.targetElevationMeters && (
                    <span
                      className={
                        result.targetElevationMeters > plan.targetElevationMeters
                          ? "text-green-600"
                          : "text-red-600"
                      }
                    >
                      {" "}
                      ({result.targetElevationMeters > plan.targetElevationMeters ? "+" : ""}
                      {formatDistance(
                        Math.abs(result.targetElevationMeters - plan.targetElevationMeters)
                      )}
                      )
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={!result || loading}>
            Apply Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
