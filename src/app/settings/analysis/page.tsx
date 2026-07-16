"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Brain, Save, Loader2, CalendarDays, Clock } from "lucide-react";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function SettingsAnalysisPage() {
  const [trigger, setTrigger] = useState("weekly");
  const [triggerValue, setTriggerValue] = useState(3);
  const [reviewDay, setReviewDay] = useState("0");
  const [reviewTime, setReviewTime] = useState("18:00");
  const [reviewDayOfMonth, setReviewDayOfMonth] = useState(1);
  const [lastAnalysisAt, setLastAnalysisAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/analysis")
      .then((r) => r.json())
      .then((data) => {
        setTrigger(data.analysisTrigger || "weekly");
        setTriggerValue(data.analysisTriggerValue || 3);
        setReviewDay(String(data.reviewDayOfWeek ?? 0));
        setReviewTime(data.reviewTime ?? "18:00");
        setReviewDayOfMonth(data.reviewDayOfMonth ?? 1);
        setLastAnalysisAt(data.lastAnalysisAt);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const body: Record<string, any> = {
        analysisTrigger: trigger,
        analysisTriggerValue: triggerValue,
        reviewTime: reviewTime,
      };
      if (trigger === "weekly" || trigger === "daily") {
        body.reviewDayOfWeek = Number(reviewDay);
      }
      if (trigger === "monthly") {
        body.reviewDayOfMonth = reviewDayOfMonth;
      }
      const res = await fetch("/api/settings/analysis", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save settings");
    }
    setSaving(false);
  }

  if (loading) return <div className="py-8">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Analysis</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure how often the AI coach analyzes your training and generates insights.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {saving ? "Saving..." : saved ? "Saved!" : "Save"}
        </Button>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 p-3 rounded mb-4">{error}</div>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5" /> Analysis Frequency
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>How often should the AI analyze your training?</Label>
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="activity_count">After every N activities</SelectItem>
                <SelectItem value="every_n_days">Review after every N days</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly (on review day)</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {trigger === "activity_count" && "Analyze after every N new activities are synced or logged."}
              {trigger === "every_n_days" && "Analyze every N days regardless of activity volume."}
              {trigger === "daily" && "Generate fresh analysis and plan adjustments every day."}
              {trigger === "weekly" && "Analyze each week on your configured review day and time."}
              {trigger === "monthly" && "Analyze on a specific day of each month."}
            </p>
          </div>

          {/* Trigger-specific options */}
          <div className="space-y-4">
            {trigger === "activity_count" && (
              <div className="space-y-2">
                <Label>Activities between analyses</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={triggerValue}
                  onChange={(e) => setTriggerValue(Math.max(1, Math.min(20, Number(e.target.value))))}
                  className="w-24"
                />
                <p className="text-xs text-muted-foreground">
                  Analysis will run after every {triggerValue} new activit{triggerValue === 1 ? "y" : "ies"}.
                </p>
              </div>
            )}

            {trigger === "every_n_days" && (
              <div className="space-y-2">
                <Label>Days between analyses</Label>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={triggerValue}
                  onChange={(e) => setTriggerValue(Math.max(1, Math.min(90, Number(e.target.value))))}
                  className="w-24"
                />
                <p className="text-xs text-muted-foreground">
                  Analysis will run every {triggerValue} day{triggerValue === 1 ? "" : "s"}.
                </p>
              </div>
            )}

            {trigger === "weekly" && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1"><CalendarDays className="h-4 w-4" /> Day of Week</Label>
                <Select value={reviewDay} onValueChange={setReviewDay}>
                  <SelectTrigger className="w-full max-w-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAY_NAMES.map((d, i) => (
                      <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {trigger === "monthly" && (
              <div className="space-y-2">
                <Label>Day of Month</Label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={reviewDayOfMonth}
                  onChange={(e) => setReviewDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value))))}
                  className="w-24"
                />
                <p className="text-xs text-muted-foreground">
                  Analysis will run on the {reviewDayOfMonth}{reviewDayOfMonth === 1 ? "st" : reviewDayOfMonth === 2 ? "nd" : reviewDayOfMonth === 3 ? "rd" : "th"} of each month.
                </p>
              </div>
            )}
          </div>

          {/* Time — common across all options */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1"><Clock className="h-4 w-4" /> Review Time</Label>
            <Input type="time" value={reviewTime} onChange={(e) => setReviewTime(e.target.value)} className="w-32" />
            <p className="text-xs text-muted-foreground">
              The analysis will run at this time on the scheduled day{trigger === "activity_count" ? ", within an hour of the trigger condition being met" : ""}.
            </p>
          </div>

          <div className="pt-4 border-t">
            <Label className="text-muted-foreground">Last analysis</Label>
            <p className="text-sm mt-1">
              {lastAnalysisAt
                ? new Date(lastAnalysisAt).toLocaleString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                    hour: "numeric", minute: "2-digit",
                  })
                : "No analysis yet — generate your first coach notes from the dashboard."}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">How It Works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <p>The AI analysis reviews your training logs, PMC metrics (CTL/ATL/TSB), race goals, health data (sleep, HRV, stress), and fatigue status to generate personalized coaching insights.</p>
          <p><strong>What you get:</strong></p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Coach&apos;s notes — a detailed analysis of your training trajectory</li>
            <li>Data drivers — what metrics influenced the analysis (CTL, TSB, HRV, etc.)</li>
            <li>Race readiness — how prepared you are for each goal race</li>
            <li>Recommendations — actionable advice for the coming week</li>
          </ul>
          <p className="text-xs italic">Note: Analysis requires an active LLM provider configuration in API &amp; Credentials.</p>
        </CardContent>
      </Card>
    </div>
  );
}
