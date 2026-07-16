"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistance } from "@/lib/utils";
import { format, differenceInDays } from "date-fns";
import { Target, Calendar, Mountain, Route, Clock, ArrowLeft, Upload, Check, Loader2, ChevronDown, ChevronUp } from "lucide-react";

interface RaceGoal {
  id: string; name: string; raceType: string; targetDate: string;
  distanceMeters: number; elevationGainMeters: number | null;
  targetTimeSeconds: number | null; priority: "A" | "B" | "C"; status: string; notes: string | null;
  goalStatement: string | null;
  courseProfile: {
    distanceMeters: number; elevationGainMeters: number;
    maxElevation: number; minElevation: number;
    pointCount: number;
  } | null;
}

export default function SettingsGoalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations("settings.goals");
  const common = useTranslations("common");
  const [goal, setGoal] = useState<RaceGoal | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    fetch(`/api/goals/${id}`).then((r) => r.json()).then(setGoal).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="py-8">{common("loading")}</div>;
  if (!goal) return <div className="py-8">{t("goalNotFound")}</div>;

  const daysUntil = differenceInDays(new Date(goal.targetDate), new Date());
  const weeksUntil = Math.max(1, Math.ceil(daysUntil / 7));

  return (
    <div className="max-w-3xl">
      <Button variant="ghost" onClick={() => router.back()} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-2" /> {t("back")}
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <Badge variant={goal.priority === "A" ? "destructive" : goal.priority === "B" ? "default" : "secondary"}>
              {t("priorityBadge", { priority: goal.priority })}
            </Badge>
            <Badge variant={goal.status === "active" ? "success" : "secondary"}>{goal.status === "active" ? t("statusActive") : t("statusCompleted")}</Badge>
          </div>
          <CardTitle className="text-2xl">{goal.name}</CardTitle>
          {goal.goalStatement && (
            <p className="text-sm text-muted-foreground italic mt-1">&ldquo;{goal.goalStatement}&rdquo;</p>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="py-4 text-center">
                <Route className="h-5 w-5 mx-auto text-primary mb-1" />
                <div className="text-xl font-bold">{formatDistance(goal.distanceMeters)}</div>
                <div className="text-xs text-muted-foreground">{t("distanceLabel")}</div>
              </CardContent>
            </Card>
            {goal.elevationGainMeters && (
              <Card>
                <CardContent className="py-4 text-center">
                  <Mountain className="h-5 w-5 mx-auto text-primary mb-1" />
                  <div className="text-xl font-bold">{formatDistance(goal.elevationGainMeters)}</div>
                  <div className="text-xs text-muted-foreground">{t("elevationGainLabel")}</div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="py-4 text-center">
                <Calendar className="h-5 w-5 mx-auto text-primary mb-1" />
                <div className="text-xl font-bold">{format(new Date(goal.targetDate), "MMM d, yyyy")}</div>
                <div className="text-xs text-muted-foreground">{daysUntil > 0 ? t("daysUntil", { daysUntil, weeksUntil }) : common("pastDue")}</div>
              </CardContent>
            </Card>
          </div>

          {goal.targetTimeSeconds && (
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t("targetTime")}</span>
              <span className="font-medium">
                {Math.floor(goal.targetTimeSeconds / 3600)}h {Math.round((goal.targetTimeSeconds % 3600) / 60)}m
              </span>
            </div>
          )}

          {/* ── Course File Upload ───────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2"><Route className="h-4 w-4" /> {t("courseProfileTitle")}</CardTitle>
                <Button
                  variant="ghost" size="sm"
                  onClick={() => setShowProfile(!showProfile)}
                >
                  {showProfile ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
            </CardHeader>
            {showProfile && (
              <CardContent>
                {goal.courseProfile ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-2 rounded bg-muted/50 text-center">
                        <div className="text-xs text-muted-foreground">{t("courseProfileDist")}</div>
                        <div className="font-semibold text-sm">{formatDistance(goal.courseProfile.distanceMeters)}</div>
                      </div>
                      <div className="p-2 rounded bg-muted/50 text-center">
                        <div className="text-xs text-muted-foreground">{t("courseProfileElev")}</div>
                        <div className="font-semibold text-sm">{formatDistance(goal.courseProfile.elevationGainMeters)}</div>
                      </div>
                      <div className="p-2 rounded bg-muted/50 text-center">
                        <div className="text-xs text-muted-foreground">{t("courseProfileMaxElev")}</div>
                        <div className="font-semibold text-sm">{goal.courseProfile.maxElevation}m</div>
                      </div>
                      <div className="p-2 rounded bg-muted/50 text-center">
                        <div className="text-xs text-muted-foreground">{t("courseProfilePoints")}</div>
                        <div className="font-semibold text-sm">{goal.courseProfile.pointCount}</div>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{t("courseProfileReplaceHint")}</p>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]');
                        if (!fileInput?.files?.[0]) return;
                        setUploading(true);
                        setUploadResult(null);
                        const fd = new FormData();
                        fd.append("file", fileInput.files[0]);
                        try {
                          const res = await fetch(`/api/goals/${goal.id}/course`, { method: "POST", body: fd });
                          const data = await res.json();
                          if (data.success) {
                            setUploadResult(t("courseProfileUpdated"));
                            setUploadError(false);
                            setGoal((prev) => prev ? { ...prev, courseProfile: data.profile } : prev);
                          } else {
                            setUploadResult(data.error || t("uploadFailed"));
                            setUploadError(true);
                          }
                        } catch {
                          setUploadResult(t("uploadFailed"));
                          setUploadError(true);
                        }
                        setUploading(false);
                      }}
                      className="flex items-center gap-2"
                    >
                      <input type="file" accept=".gpx,.tcx,.fit" className="text-xs flex-1" disabled={uploading} />
                      <Button type="submit" size="sm" disabled={uploading}>
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {t("upload")}
                      </Button>
                    </form>
                    {uploadResult && (
                      <p className={`text-xs ${uploadError ? "text-destructive" : "text-green-600"}`}>
                        {uploadError ? "" : <Check className="h-3 w-3 inline mr-1" />}
                        {uploadResult}
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {t("courseProfileUploadHint")}
                    </p>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]');
                        if (!fileInput?.files?.[0]) return;
                        setUploading(true);
                        setUploadResult(null);
                        const fd = new FormData();
                        fd.append("file", fileInput.files[0]);
                        try {
                          const res = await fetch(`/api/goals/${goal.id}/course`, { method: "POST", body: fd });
                          const data = await res.json();
                          if (data.success) {
                            setUploadResult(t("courseProfileUploaded"));
                            setUploadError(false);
                            setGoal((prev) => prev ? { ...prev, courseProfile: data.profile } : prev);
                          } else {
                            setUploadResult(data.error || t("uploadFailed"));
                            setUploadError(true);
                          }
                        } catch {
                          setUploadResult(t("uploadFailed"));
                          setUploadError(true);
                        }
                        setUploading(false);
                      }}
                      className="flex items-center gap-2"
                    >
                      <input type="file" accept=".gpx,.tcx,.fit" className="text-xs flex-1" disabled={uploading} />
                      <Button type="submit" size="sm" disabled={uploading}>
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {t("upload")}
                      </Button>
                    </form>
                    {uploadResult && (
                      <p className={`text-xs mt-2 ${uploadError ? "text-destructive" : "text-green-600"}`}>
                        {uploadError ? "" : <Check className="h-3 w-3 inline mr-1" />}
                        {uploadResult}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">{t("trainingPlanTitle")}</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("recommendedWeeklyVolume")}</span>
                  <span className="font-medium">{formatDistance(goal.distanceMeters * 0.7)}</span>
                </div>
                {goal.elevationGainMeters && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("recommendedWeeklyVert")}</span>
                    <span className="font-medium">{formatDistance(goal.elevationGainMeters * 0.5)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("weeksRemaining")}</span>
                  <span className="font-medium">{weeksUntil}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("volumeRampRate")}</span>
                  <span className="font-medium">{t("volumeRampRateValue")}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {goal.notes && (
            <div>
              <h3 className="font-semibold mb-2">{t("notes")}</h3>
              <p className="text-sm text-muted-foreground">{goal.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
