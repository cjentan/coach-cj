"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Brain, Save, Loader2, CalendarDays, Clock } from "lucide-react";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function SettingsAnalysisPage() {
  const t = useTranslations("settings.analysis");
  const common = useTranslations("common");
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
      setError(t("saveError"));
    }
    setSaving(false);
  }

  if (loading) return <div className="py-8">{common("loading")}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("description")}
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {saving ? common("saving") : saved ? t("saved") : common("save")}
        </Button>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 p-3 rounded mb-4">{error}</div>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5" /> {t("frequency")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>{t("frequencyLabel")}</Label>
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="activity_count">{t("optionActivityCount")}</SelectItem>
                <SelectItem value="every_n_days">{t("optionEveryNDays")}</SelectItem>
                <SelectItem value="daily">{t("optionDaily")}</SelectItem>
                <SelectItem value="weekly">{t("optionWeekly")}</SelectItem>
                <SelectItem value="monthly">{t("optionMonthly")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {trigger === "activity_count" && t("descActivityCount")}
              {trigger === "every_n_days" && t("descEveryNDays")}
              {trigger === "daily" && t("descDaily")}
              {trigger === "weekly" && t("descWeekly")}
              {trigger === "monthly" && t("descMonthly")}
            </p>
          </div>

          {/* Trigger-specific options */}
          <div className="space-y-4">
            {trigger === "activity_count" && (
              <div className="space-y-2">
                <Label>{t("activitiesBetweenLabel")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={triggerValue}
                  onChange={(e) => setTriggerValue(Math.max(1, Math.min(20, Number(e.target.value))))}
                  className="w-24"
                />
                <p className="text-xs text-muted-foreground">
                  {t("activitiesBetweenDescription", { count: triggerValue })}
                </p>
              </div>
            )}

            {trigger === "every_n_days" && (
              <div className="space-y-2">
                <Label>{t("daysBetweenLabel")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={triggerValue}
                  onChange={(e) => setTriggerValue(Math.max(1, Math.min(90, Number(e.target.value))))}
                  className="w-24"
                />
                <p className="text-xs text-muted-foreground">
                  {t("daysBetweenDescription", { count: triggerValue })}
                </p>
              </div>
            )}

            {trigger === "weekly" && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1"><CalendarDays className="h-4 w-4" /> {t("dayOfWeek")}</Label>
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
                <Label>{t("dayOfMonth")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={reviewDayOfMonth}
                  onChange={(e) => setReviewDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value))))}
                  className="w-24"
                />
                <p className="text-xs text-muted-foreground">
                  {t("dayOfMonthDescription", { day: reviewDayOfMonth })}
                </p>
              </div>
            )}
          </div>

          {/* Time — common across all options */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1"><Clock className="h-4 w-4" /> {t("reviewTime")}</Label>
            <Input type="time" value={reviewTime} onChange={(e) => setReviewTime(e.target.value)} className="w-32" />
            <p className="text-xs text-muted-foreground">
              {trigger === "activity_count" ? t("reviewTimeDescription") : t("reviewTimeDescriptionSimple")}
            </p>
          </div>

          <div className="pt-4 border-t">
            <Label className="text-muted-foreground">{t("lastAnalysis")}</Label>
            <p className="text-sm mt-1">
              {lastAnalysisAt
                ? new Date(lastAnalysisAt).toLocaleString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                    hour: "numeric", minute: "2-digit",
                  })
                : t("noAnalysis")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("howItWorks")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <p>{t("howItWorksDescription")}</p>
          <p><strong>{t("whatYouGet")}</strong></p>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t("itemCoachNotes")}</li>
            <li>{t("itemDataDrivers")}</li>
            <li>{t("itemRaceReadiness")}</li>
            <li>{t("itemRecommendations")}</li>
          </ul>
          <p className="text-xs italic">{t("llmNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
