"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Watch,
  Activity,
  Plug,
  CheckCircle2,
  XCircle,
  Loader2,
  Target,
  Scale,
  CalendarDays,
  Brain,
  Clock,
  ChevronRight,
  ChevronLeft,
  SkipForward,
  Check,
} from "lucide-react";
import { LONG_DAY_NAMES, RACE_TYPES } from "@/lib/constants";
import {
  distanceToMeters,
  elevationToMeters,
  defaultDistanceUnit,
  defaultElevationUnit,
  type DistanceUnit,
  type ElevationUnit,
} from "@/lib/utils";
import { useUnits } from "@/hooks/use-units";

// ── Helper Components ────────────────────────────────────────

function StepIndicator({
  current,
  steps,
}: {
  current: number;
  steps: { num: number; label: string; icon: React.ElementType }[];
}) {
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2 mb-10">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const isActive = i === current;
        const isDone = i < current;
        return (
          <div key={s.num} className="flex items-center gap-1 sm:gap-2">
            <div
              className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : isDone
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px w-4 sm:w-8 ${isDone ? "bg-primary" : "bg-muted"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ExplanationCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/50 border px-4 py-3 text-sm text-muted-foreground leading-relaxed">
      {children}
    </div>
  );
}

function StepFooter({
  onBack,
  onNext,
  onSkip,
  canNext,
  nextLabel,
  isLast = false,
  saving = false,
}: {
  onBack?: () => void;
  onNext?: () => void;
  onSkip?: () => void;
  canNext?: boolean;
  nextLabel?: string;
  isLast?: boolean;
  saving?: boolean;
}) {
  const t = useTranslations("onboarding");
  const label = nextLabel ?? t("next");
  return (
    <div className="flex items-center justify-between pt-6 border-t mt-8">
      <div>
        {onBack && (
          <Button variant="outline" size="sm" onClick={onBack}>
            <ChevronLeft className="h-4 w-4 mr-1" /> {t("back")}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {onSkip && (
          <Button variant="ghost" size="sm" onClick={onSkip} disabled={saving}>
            <SkipForward className="h-4 w-4 mr-1" /> {t("skip")}
          </Button>
        )}
        {onNext && (
          <Button size="sm" onClick={onNext} disabled={!canNext || saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" /> {t("saving")}
              </>
            ) : (
              <>
                {label} <ChevronRight className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────

export default function OnboardingPage() {
  const t = useTranslations("onboarding");
  const settingsT = useTranslations("settings");
  const labelsT = useTranslations("labels");
  const common = useTranslations("common");
  const steps = [
    { num: 0, label: t("steps.integration"), icon: Activity },
    { num: 1, label: t("steps.review"), icon: Brain },
    { num: 2, label: t("steps.goals"), icon: Target },
    { num: 3, label: t("steps.bodyMetrics"), icon: Scale },
  ];
  const { data: session, status } = useSession();
  const { units } = useUnits();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

  // Step 1: Integration
  const [integrationType, setIntegrationType] = useState<"garmin" | "coros" | null>(null);
  const [garminConnected, setGarminConnected] = useState(false);
  const [garminEmail, setGarminEmail] = useState("");
  const [garminPassword, setGarminPassword] = useState("");
  const [garminMfaRequired, setGarminMfaRequired] = useState(false);
  const [garminMfaCode, setGarminMfaCode] = useState("");
  const [garminConnecting, setGarminConnecting] = useState(false);
  const [garminError, setGarminError] = useState<string | null>(null);
  const [garminDisplayName, setGarminDisplayName] = useState<string | null>(null);

  const [corosConnected, setCorosConnected] = useState(false);
  const [corosEmail, setCorosEmail] = useState("");
  const [corosPassword, setCorosPassword] = useState("");
  const [corosConnecting, setCorosConnecting] = useState(false);
  const [corosError, setCorosError] = useState<string | null>(null);

  // Step 2: Review & Analysis
  const [reviewDay, setReviewDay] = useState("0");
  const [reviewTime, setReviewTime] = useState("18:00");
  const [analysisTrigger, setAnalysisTrigger] = useState("weekly");
  const [analysisTriggerValue, setAnalysisTriggerValue] = useState(3);
  const [reviewDayOfMonth, setReviewDayOfMonth] = useState(1);

  // Step 3: Goal
  const [goalName, setGoalName] = useState("");
  const [goalRaceType, setGoalRaceType] = useState("road_run");
  const [goalTargetDate, setGoalTargetDate] = useState("");
  const [goalDistance, setGoalDistance] = useState("");
  const [goalElevation, setGoalElevation] = useState("");
  // Input units default to the app-wide Units setting; values convert to
  // meters before saving.
  const [goalDistUnit, setGoalDistUnit] = useState<DistanceUnit>(() => defaultDistanceUnit(units));
  const [goalEleUnit, setGoalEleUnit] = useState<ElevationUnit>(() => defaultElevationUnit(units));
  const [goalPriority, setGoalPriority] = useState("B");
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalSaved, setGoalSaved] = useState(false);

  // Step 5: Body Metrics
  const [metricDate, setMetricDate] = useState(new Date().toISOString().slice(0, 10));
  const [metricWeight, setMetricWeight] = useState("");
  const [metricHeight, setMetricHeight] = useState("");
  const [metricRestingHr, setMetricRestingHr] = useState("");
  const [metricMaxHr, setMetricMaxHr] = useState("");
  const [metricSaving, setMetricSaving] = useState(false);
  const [metricSaved, setMetricSaved] = useState(false);

  // ── Auth guard + onboarding check ──────────────────────────

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    } else if (status === "authenticated") {
      // If onboarding is already complete, go to dashboard
      fetch("/api/settings/onboarding")
        .then((r) => r.json())
        .then((data) => {
          if (data.onboardingCompleted) {
            router.push("/dashboard");
          } else {
            setPageLoading(false);
          }
        })
        .catch(() => setPageLoading(false));
    }
  }, [status, router]);

  if (pageLoading || status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mr-2" />
        {common("loading")}
      </div>
    );
  }

  // ── Step Handlers ──────────────────────────────────────────

  const handleGarminConnect = async () => {
    if (!garminEmail || !garminPassword) return;
    setGarminConnecting(true);
    setGarminError(null);
    try {
      const body: Record<string, string> = {
        email: garminEmail,
        password: garminPassword,
      };
      if (garminMfaCode) body.mfaCode = garminMfaCode;

      const res = await fetch("/api/integrations/garmin/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setGarminConnected(true);
        setIntegrationType("garmin");
        setGarminDisplayName(data.displayName || null);
      } else if (data.mfaRequired) {
        setGarminMfaRequired(true);
        setGarminError(t("integration.mfaRequired"));
      } else {
        setGarminError(data.error || t("integration.connectionFailed"));
      }
    } catch {
      setGarminError(t("integration.networkError"));
    } finally {
      setGarminConnecting(false);
    }
  };

  const handleCorosConnect = async () => {
    if (!corosEmail || !corosPassword) return;
    setCorosConnecting(true);
    setCorosError(null);
    try {
      const res = await fetch("/api/integrations/coros/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: corosEmail,
          password: corosPassword,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCorosConnected(true);
        setIntegrationType("coros");
      } else {
        setCorosError(data.error || t("integration.connectionFailed"));
      }
    } catch {
      setCorosError(t("integration.networkError"));
    } finally {
      setCorosConnecting(false);
    }
  };

  const handleSaveReviewAndAnalysis = async () => {
    setSaving(true);
    try {
      const body: Record<string, any> = {
        analysisTrigger,
        analysisTriggerValue,
        reviewTime,
      };
      if (analysisTrigger === "weekly" || analysisTrigger === "daily") {
        body.reviewDayOfWeek = Number(reviewDay);
      }
      if (analysisTrigger === "monthly") {
        body.reviewDayOfMonth = reviewDayOfMonth;
      }
      await fetch("/api/settings/analysis", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // Continue even on error
    }
    setSaving(false);
    setCurrentStep(2);
  };

  const handleSaveGoal = async () => {
    if (!goalName.trim() || !goalTargetDate || !goalDistance) return;
    setGoalSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: goalName,
        raceType: goalRaceType,
        targetDate: goalTargetDate,
        distanceMeters: distanceToMeters(Number(goalDistance), goalDistUnit),
      };
      if (goalElevation)
        body.elevationGainMeters = elevationToMeters(Number(goalElevation), goalEleUnit);
      body.priority = goalPriority;

      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setGoalSaved(true);
      }
    } catch {
      // Ignore
    }
    setGoalSaving(false);
  };

  const handleSaveBodyMetric = async () => {
    if (!metricWeight) return;
    setMetricSaving(true);
    try {
      const body: Record<string, unknown> = {
        recordedAt: metricDate,
        weightKg: Number(metricWeight),
      };
      if (metricHeight) body.heightCm = Number(metricHeight);
      if (metricRestingHr) body.restingHr = Number(metricRestingHr);

      const res = await fetch("/api/body-metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setMetricSaved(true);
      }

      // Optional max HR — anchors all HR zones. Saved separately via the
      // settings API so an empty body-metrics save never blocks it.
      if (metricMaxHr) {
        const maxHrNum = Number(metricMaxHr);
        if (Number.isInteger(maxHrNum) && maxHrNum >= 30 && maxHrNum <= 220) {
          await fetch("/api/settings/max-hr", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ maxHr: maxHrNum }),
          }).catch(() => {});
        }
      }
    } catch {
      // Ignore
    }
    setMetricSaving(false);
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/onboarding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        router.push("/dashboard");
      }
    } catch {
      // Ignore
    }
    setSaving(false);
  };

  const handleDismiss = async () => {
    if (!confirm(t("skipConfirm"))) return;
    setSaving(true);
    try {
      await fetch("/api/settings/onboarding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      router.push("/dashboard");
    } catch {
      // Ignore
    }
    setSaving(false);
  };

  // ── Render Step Content ────────────────────────────────────

  const renderStep = () => {
    switch (currentStep) {
      // ── Step 0: Integration ──
      case 0:
        return (
          <div>
            <div className="text-center mb-8">
              <Activity className="h-10 w-10 text-primary mx-auto mb-4" />
              <h1 className="text-2xl font-bold mb-2">{t("integration.title")}</h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {t("integration.description")}
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {/* COROS Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Watch className="h-5 w-5" /> {t("integration.corosTitle")}
                  </CardTitle>
                  <CardDescription>{t("integration.corosDesc")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {corosConnected ? (
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="font-medium">{t("integration.connected")}</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <XCircle className="h-4 w-4" />
                        <span className="text-sm">{t("integration.notConnected")}</span>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="coros-email" className="text-xs">
                          {t("integration.emailLabel")}
                        </Label>
                        <Input
                          id="coros-email"
                          type="email"
                          size={20}
                          value={corosEmail}
                          onChange={(e) => setCorosEmail(e.target.value)}
                          placeholder="your@email.com"
                          disabled={corosConnecting}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="coros-password" className="text-xs">
                          {t("integration.passwordLabel")}
                        </Label>
                        <Input
                          id="coros-password"
                          type="password"
                          value={corosPassword}
                          onChange={(e) => setCorosPassword(e.target.value)}
                          placeholder={t("integration.corosPassword")}
                          disabled={corosConnecting}
                        />
                      </div>
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={handleCorosConnect}
                        disabled={corosConnecting || !corosEmail || !corosPassword}
                      >
                        {corosConnecting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />{" "}
                            {t("integration.connecting")}
                          </>
                        ) : (
                          <>
                            <Plug className="h-4 w-4 mr-1" /> {t("integration.connectCoros")}
                          </>
                        )}
                      </Button>
                      {corosError && <p className="text-xs text-destructive">{corosError}</p>}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Garmin Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="h-5 w-5" /> Garmin Connect
                  </CardTitle>
                  <CardDescription>{t("integration.garminDesc")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {garminConnected ? (
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="font-medium">{t("integration.connected")}</span>
                      {garminDisplayName && (
                        <Badge variant="outline" className="ml-1">
                          {garminDisplayName}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <XCircle className="h-4 w-4" />
                        <span className="text-sm">{t("integration.notConnected")}</span>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="garmin-email" className="text-xs">
                          {t("integration.emailLabel")}
                        </Label>
                        <Input
                          id="garmin-email"
                          type="email"
                          value={garminEmail}
                          onChange={(e) => setGarminEmail(e.target.value)}
                          placeholder="your@email.com"
                          disabled={garminConnecting}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="garmin-password" className="text-xs">
                          {t("integration.passwordLabel")}
                        </Label>
                        <Input
                          id="garmin-password"
                          type="password"
                          value={garminPassword}
                          onChange={(e) => setGarminPassword(e.target.value)}
                          placeholder={t("integration.garminPassword")}
                          disabled={garminConnecting || garminMfaRequired}
                        />
                      </div>
                      {garminMfaRequired && (
                        <div className="space-y-1.5">
                          <Label htmlFor="garmin-mfa" className="text-xs">
                            {t("integration.mfaCodeLabel")}
                          </Label>
                          <Input
                            id="garmin-mfa"
                            type="text"
                            value={garminMfaCode}
                            onChange={(e) => setGarminMfaCode(e.target.value)}
                            placeholder={t("integration.mfaPlaceholder")}
                            disabled={garminConnecting}
                          />
                        </div>
                      )}
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={handleGarminConnect}
                        disabled={
                          garminConnecting ||
                          !garminEmail ||
                          !garminPassword ||
                          (garminMfaRequired && !garminMfaCode)
                        }
                      >
                        {garminConnecting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />{" "}
                            {t("integration.connecting")}
                          </>
                        ) : (
                          <>
                            <Plug className="h-4 w-4 mr-1" /> {t("integration.connectGarmin")}
                          </>
                        )}
                      </Button>
                      {garminError && <p className="text-xs text-destructive">{garminError}</p>}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <ExplanationCard>{t("integration.explanation")}</ExplanationCard>

            <StepFooter onNext={() => setCurrentStep(1)} onSkip={() => setCurrentStep(1)} canNext />
          </div>
        );

      // ── Step 1: Review & Analysis ──
      case 1:
        return (
          <div>
            <div className="text-center mb-8">
              <Brain className="h-10 w-10 text-primary mx-auto mb-4" />
              <h1 className="text-2xl font-bold mb-2">{t("review.title")}</h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {t("review.description")}
              </p>
            </div>

            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Brain className="h-4 w-4" /> {t("review.cardTitle")}
                </CardTitle>
                <CardDescription>{t("review.cardDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{t("review.frequencyLabel")}</Label>
                  <Select value={analysisTrigger} onValueChange={setAnalysisTrigger}>
                    <SelectTrigger className="max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="activity_count">
                        {settingsT("analysis.optionActivityCount")}
                      </SelectItem>
                      <SelectItem value="every_n_days">
                        {settingsT("analysis.optionEveryNDays")}
                      </SelectItem>
                      <SelectItem value="daily">{settingsT("analysis.optionDaily")}</SelectItem>
                      <SelectItem value="weekly">{settingsT("analysis.optionWeekly")}</SelectItem>
                      <SelectItem value="monthly">{settingsT("analysis.optionMonthly")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Trigger-specific options */}
                {analysisTrigger === "activity_count" && (
                  <div className="flex items-center gap-2">
                    <Label>{t("review.everyLabel")}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={analysisTriggerValue}
                      onChange={(e) =>
                        setAnalysisTriggerValue(Math.max(1, Math.min(20, Number(e.target.value))))
                      }
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">
                      {t("review.activityCountSuffix", { count: analysisTriggerValue })}
                    </span>
                  </div>
                )}

                {analysisTrigger === "every_n_days" && (
                  <div className="flex items-center gap-2">
                    <Label>{t("review.everyLabel")}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={90}
                      value={analysisTriggerValue}
                      onChange={(e) =>
                        setAnalysisTriggerValue(Math.max(1, Math.min(90, Number(e.target.value))))
                      }
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">
                      {t("review.daySuffix", { count: analysisTriggerValue })}
                    </span>
                  </div>
                )}

                {analysisTrigger === "weekly" && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1">
                      <CalendarDays className="h-4 w-4" /> {settingsT("analysis.dayOfWeek")}
                    </Label>
                    <Select value={reviewDay} onValueChange={setReviewDay}>
                      <SelectTrigger className="max-w-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LONG_DAY_NAMES.map((d, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {labelsT("days.long." + d)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {analysisTrigger === "monthly" && (
                  <div className="flex items-center gap-2">
                    <Label>{t("review.dayOfMonth")}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={reviewDayOfMonth}
                      onChange={(e) =>
                        setReviewDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value))))
                      }
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">
                      {reviewDayOfMonth === 1
                        ? t("review.ordinalSt")
                        : reviewDayOfMonth === 2
                          ? t("review.ordinalNd")
                          : reviewDayOfMonth === 3
                            ? t("review.ordinalRd")
                            : t("review.ordinalTh")}
                    </span>
                  </div>
                )}

                {/* Time — common across all options */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    <Clock className="h-4 w-4" /> {settingsT("analysis.reviewTime")}
                  </Label>
                  <Input
                    type="time"
                    value={reviewTime}
                    onChange={(e) => setReviewTime(e.target.value)}
                    className="w-32"
                  />
                </div>
              </CardContent>
            </Card>

            <ExplanationCard>{t("review.explanation")}</ExplanationCard>

            <StepFooter
              onBack={() => setCurrentStep(0)}
              onNext={handleSaveReviewAndAnalysis}
              canNext
              saving={saving}
            />
          </div>
        );

      // ── Step 2: Goals ──
      case 2:
        return (
          <div>
            <div className="text-center mb-8">
              <Target className="h-10 w-10 text-primary mx-auto mb-4" />
              <h1 className="text-2xl font-bold mb-2">{t("goal.title")}</h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {t("goal.description")}
              </p>
            </div>

            {goalSaved ? (
              <Card className="mb-4 border-green-300 bg-green-50 dark:bg-green-950/20">
                <CardContent className="p-6 text-center">
                  <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="font-medium text-green-700 dark:text-green-300">
                    {t("goal.savedTitle")}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">{t("goal.savedDescription")}</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="mb-4">
                <CardHeader>
                  <CardTitle className="text-base">{settingsT("goals.newGoal")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="goal-name" className="text-xs">
                        {settingsT("goals.name")}
                      </Label>
                      <Input
                        id="goal-name"
                        value={goalName}
                        onChange={(e) => setGoalName(e.target.value)}
                        placeholder={t("goal.namePlaceholder")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="goal-type" className="text-xs">
                        {settingsT("goals.raceType")}
                      </Label>
                      <Select value={goalRaceType} onValueChange={setGoalRaceType}>
                        <SelectTrigger id="goal-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RACE_TYPES.map((rt) => (
                            <SelectItem key={rt.value} value={rt.value}>
                              {labelsT("raceTypes." + rt.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="goal-date" className="text-xs">
                        {settingsT("goals.targetDate")}
                      </Label>
                      <Input
                        id="goal-date"
                        type="date"
                        value={goalTargetDate}
                        onChange={(e) => setGoalTargetDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="goal-distance" className="text-xs">
                        {settingsT("goals.distance")}
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="goal-distance"
                          type="number"
                          min="0"
                          step="any"
                          className="flex-1"
                          value={goalDistance}
                          onChange={(e) => setGoalDistance(e.target.value)}
                          placeholder={
                            goalDistUnit === "m"
                              ? t("goal.distancePlaceholderM")
                              : goalDistUnit === "km"
                                ? t("goal.distancePlaceholderKm")
                                : t("goal.distancePlaceholderMi")
                          }
                        />
                        <Select
                          value={goalDistUnit}
                          onValueChange={(v) => setGoalDistUnit(v as DistanceUnit)}
                        >
                          <SelectTrigger className="w-[92px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="m">{t("goal.unitMeters")}</SelectItem>
                            <SelectItem value="km">{t("goal.unitKilometers")}</SelectItem>
                            <SelectItem value="mi">{t("goal.unitMiles")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="goal-elevation" className="text-xs">
                        {t("goal.elevationLabel")}
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="goal-elevation"
                          type="number"
                          min="0"
                          step="any"
                          className="flex-1"
                          value={goalElevation}
                          onChange={(e) => setGoalElevation(e.target.value)}
                          placeholder={
                            goalEleUnit === "m"
                              ? t("goal.elevationPlaceholderM")
                              : t("goal.elevationPlaceholderFt")
                          }
                        />
                        <Select
                          value={goalEleUnit}
                          onValueChange={(v) => setGoalEleUnit(v as ElevationUnit)}
                        >
                          <SelectTrigger className="w-[92px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="m">{t("goal.unitMeters")}</SelectItem>
                            <SelectItem value="ft">{t("goal.unitFeet")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="mt-4"
                    onClick={handleSaveGoal}
                    disabled={goalSaving || !goalName.trim() || !goalTargetDate || !goalDistance}
                  >
                    {goalSaving ? t("saving") : t("goal.saveGoal")}
                  </Button>
                </CardContent>
              </Card>
            )}

            <ExplanationCard>{t("goal.explanation")}</ExplanationCard>

            <StepFooter
              onBack={() => setCurrentStep(1)}
              onNext={() => setCurrentStep(3)}
              onSkip={() => {
                setGoalSaved(true);
                setCurrentStep(3);
              }}
              canNext
            />
          </div>
        );

      // ── Step 3: Body Metrics ──
      case 3:
        return (
          <div>
            <div className="text-center mb-8">
              <Scale className="h-10 w-10 text-primary mx-auto mb-4" />
              <h1 className="text-2xl font-bold mb-2">{t("bodyMetrics.title")}</h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {t("bodyMetrics.description")}
              </p>
            </div>

            {metricSaved ? (
              <Card className="mb-4 border-green-300 bg-green-50 dark:bg-green-950/20">
                <CardContent className="p-6 text-center">
                  <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="font-medium text-green-700 dark:text-green-300">
                    {t("bodyMetrics.savedTitle")}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="mb-4">
                <CardHeader>
                  <CardTitle className="text-base">{t("bodyMetrics.cardTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="metric-date" className="text-xs">
                        {t("bodyMetrics.dateLabel")}
                      </Label>
                      <Input
                        id="metric-date"
                        type="date"
                        value={metricDate}
                        onChange={(e) => setMetricDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="metric-weight" className="text-xs">
                        {t("bodyMetrics.weightLabel")}
                      </Label>
                      <Input
                        id="metric-weight"
                        type="number"
                        min="20"
                        max="500"
                        step="0.1"
                        value={metricWeight}
                        onChange={(e) => setMetricWeight(e.target.value)}
                        placeholder={t("bodyMetrics.weightPlaceholder")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="metric-height" className="text-xs">
                        {t("bodyMetrics.heightLabel")}
                      </Label>
                      <Input
                        id="metric-height"
                        type="number"
                        min="100"
                        max="250"
                        value={metricHeight}
                        onChange={(e) => setMetricHeight(e.target.value)}
                        placeholder={t("bodyMetrics.heightPlaceholder")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="metric-resting-hr" className="text-xs">
                        {t("bodyMetrics.restingHrLabel")}
                      </Label>
                      <Input
                        id="metric-resting-hr"
                        type="number"
                        min="30"
                        max="220"
                        value={metricRestingHr}
                        onChange={(e) => setMetricRestingHr(e.target.value)}
                        placeholder={t("bodyMetrics.restingHrPlaceholder")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="metric-max-hr" className="text-xs">
                        {t("bodyMetrics.maxHrLabel")}
                      </Label>
                      <Input
                        id="metric-max-hr"
                        type="number"
                        min="30"
                        max="220"
                        value={metricMaxHr}
                        onChange={(e) => setMetricMaxHr(e.target.value)}
                        placeholder={t("bodyMetrics.maxHrPlaceholder")}
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="mt-4"
                    onClick={handleSaveBodyMetric}
                    disabled={metricSaving || !metricWeight}
                  >
                    {metricSaving ? t("saving") : t("bodyMetrics.saveEntry")}
                  </Button>
                </CardContent>
              </Card>
            )}

            <ExplanationCard>{t("bodyMetrics.explanation")}</ExplanationCard>

            <StepFooter
              onBack={() => setCurrentStep(2)}
              onNext={() => setCurrentStep(4)}
              onSkip={() => {
                setMetricSaved(true);
                setCurrentStep(4);
              }}
              canNext
            />
          </div>
        );

      // ── Step 4: Completion ──
      case 4:
        return (
          <div className="text-center">
            <div className="mb-6">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Check className="h-8 w-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold mb-2">{t("complete")}</h1>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                {t("completionDescription")}
              </p>
            </div>

            <div className="max-w-md mx-auto text-left space-y-3 mb-8">
              <SummaryItem
                icon={integrationType ? CheckCircle2 : XCircle}
                label={t("summary.wearable")}
                detail={
                  integrationType
                    ? t("summary.wearableConnected", {
                        type: integrationType === "garmin" ? "Garmin" : "COROS",
                      })
                    : t("summary.wearableSkipped")
                }
                done={!!integrationType}
              />
              <SummaryItem
                icon={Check}
                label={t("summary.reviewSchedule")}
                detail={
                  analysisTrigger === "weekly"
                    ? `${labelsT("days.long." + LONG_DAY_NAMES[Number(reviewDay)])} ${t("review.at")} ${reviewTime}`
                    : analysisTrigger === "monthly"
                      ? t("review.monthlySummary", { day: reviewDayOfMonth, time: reviewTime })
                      : analysisTrigger === "daily"
                        ? t("review.dailySummary", { time: reviewTime })
                        : analysisTrigger === "every_n_days"
                          ? t("review.everyNDaysSummary", {
                              count: analysisTriggerValue,
                              time: reviewTime,
                            })
                          : analysisTrigger === "activity_count"
                            ? t("review.afterNActivities", { count: analysisTriggerValue })
                            : analysisTrigger
                }
                done
              />
              <SummaryItem
                icon={goalSaved ? Check : XCircle}
                label={t("summary.raceGoal")}
                detail={goalSaved ? goalName : t("summary.skipped")}
                done={goalSaved}
              />
              <SummaryItem
                icon={metricSaved ? Check : XCircle}
                label={t("summary.bodyMetrics")}
                detail={metricSaved ? t("summary.loggedToday") : t("summary.skipped")}
                done={metricSaved}
              />
            </div>

            <Button size="lg" onClick={handleComplete} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" /> {t("finalizing")}
                </>
              ) : (
                <>
                  {t("goToDashboard")} <ChevronRight className="h-5 w-5 ml-1" />
                </>
              )}
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Progress indicator */}
        {currentStep < 4 && <StepIndicator current={currentStep} steps={steps} />}

        <div className="min-h-[400px]">{renderStep()}</div>

        {/* Dismiss link — shown on all wizard steps except completion */}
        {currentStep < 4 && (
          <div className="text-center mt-6">
            <button
              onClick={handleDismiss}
              disabled={saving}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors disabled:opacity-50"
            >
              {t("skipDashboard")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryItem({
  icon: Icon,
  label,
  detail,
  done,
}: {
  icon: React.ElementType;
  label: string;
  detail: string;
  done: boolean;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon className={`h-5 w-5 shrink-0 ${done ? "text-green-500" : "text-muted-foreground"}`} />
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">{detail}</p>
      </div>
    </div>
  );
}
