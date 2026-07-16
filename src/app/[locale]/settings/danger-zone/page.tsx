"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { AlertTriangle, Trash2 } from "lucide-react";

const DATA_TYPES = [
  { key: "trainingLogs", label: "Activities", description: "Activities, laps, splits, and all training data" },
  { key: "raceGoals", label: "Race Goals", description: "Target races, events, and goal times" },
  { key: "trainingFacilities", label: "Training Facilities", description: "Saved locations, routes, and facilities" },
  { key: "bodyMetrics", label: "Body Metrics", description: "Weight, resting heart rate, and body measurements" },
  { key: "availability", label: "Availability", description: "Weekly training time slots" },
  { key: "weeklyAssessments", label: "Weekly Assessments", description: "CTL, ATL, TSB and readiness scores" },
  { key: "weeklyPlans", label: "Weekly Plans", description: "AI-generated weekly training plans" },
  { key: "fatigueAlerts", label: "Fatigue Alerts", description: "Overtraining and fatigue notifications" },
] as const;

export default function DangerZonePage() {
  const t = useTranslations("settings.dangerZone");
  const common = useTranslations("common");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [wipeConfirm, setWipeConfirm] = useState(false);
  const [wiping, setWiping] = useState(false);

  const toggleType = (key: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelectedTypes(new Set(DATA_TYPES.map((dt) => dt.key)));
  const deselectAll = () => setSelectedTypes(new Set());

  const handleWipe = async () => {
    const types = Array.from(selectedTypes);
    setWiping(true);
    const res = await fetch("/api/settings/wipe-data", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ types }),
    });
    if (res.ok) {
      const data = await res.json();
      const summary = types.map((t) => {
        const label = DATA_TYPES.find((dt) => dt.key === t)?.label ?? t;
        return `${label}: ${data.counts?.[t] ?? 0} deleted`;
      });
      setMessage({ type: "success", text: t("deletedSuccess", { summary: summary.join(", ") }) });
    } else {
      setMessage({ type: "error", text: t("wipeError") });
    }
    setWiping(false);
    setWipeConfirm(false);
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-destructive flex items-center gap-2">
          <AlertTriangle className="h-6 w-6" />
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("description")}
        </p>
      </div>

      {message && (
        <div className={`p-4 rounded-md mb-6 text-sm ${message.type === "success" ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-destructive/10 text-destructive"}`}>
          {message.text}
        </div>
      )}

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" /> {t("wipeData")}
          </CardTitle>
          <CardDescription>
            {t("wipeDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!wipeConfirm ? (
            <>
              {/* Data type checklist */}
              <div className="space-y-1 mb-4">
                {DATA_TYPES.map((dt) => (
                  <label
                    key={dt.key}
                    className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-destructive/40 text-destructive focus:ring-destructive/30 accent-destructive"
                      checked={selectedTypes.has(dt.key)}
                      onChange={() => toggleType(dt.key)}
                    />
                    <div>
                      <p className="text-sm font-medium">{dt.label}</p>
                      <p className="text-xs text-muted-foreground">{dt.description}</p>
                    </div>
                  </label>
                ))}
              </div>

              {/* Select all / deselect all */}
              <div className="flex gap-2 mb-4">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  {t("selectAll")}
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAll}>
                  {t("deselectAll")}
                </Button>
              </div>

              <Button
                variant="destructive"
                disabled={selectedTypes.size === 0}
                onClick={() => setWipeConfirm(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t("wipeSelected", { count: selectedTypes.size })}
              </Button>
            </>
          ) : (
            <div className="space-y-4 p-4 rounded-md bg-destructive/10 border border-destructive/30">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-destructive">{t("confirmTitle")}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("confirmDescription")}</p>
                </div>
              </div>

              <ul className="text-sm space-y-1 ml-8 list-disc text-muted-foreground">
                {Array.from(selectedTypes).map((key) => {
                  const dt = DATA_TYPES.find((t) => t.key === key);
                  return <li key={key}>{dt?.label ?? key}</li>;
                })}
              </ul>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={wiping}
                  onClick={handleWipe}
                >
                  {wiping ? t("deleting") : t("confirmDelete", { count: selectedTypes.size })}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={wiping}
                  onClick={() => setWipeConfirm(false)}
                >
                  {common("cancel")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
