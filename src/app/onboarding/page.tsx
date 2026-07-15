"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
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
  Dumbbell,
  Target,
  Scale,
  CalendarDays,
  Brain,
  Clock,
  ChevronRight,
  ChevronLeft,
  SkipForward,
  Plus,
  Trash2,
  Mountain,
  Route,
  Heart,
  Check,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const RACE_TYPES = [
  { value: "road_run", label: "Road Run" },
  { value: "trail_run", label: "Trail Run" },
  { value: "marathon", label: "Marathon" },
  { value: "ultra", label: "Ultra" },
  { value: "triathlon", label: "Triathlon" },
  { value: "cycling", label: "Cycling" },
  { value: "other", label: "Other" },
];

const STEPS = [
  { num: 0, label: "Integration", icon: Activity },
  { num: 1, label: "Review & Analysis", icon: Brain },
  { num: 2, label: "Facilities", icon: Dumbbell },
  { num: 3, label: "Goals", icon: Target },
  { num: 4, label: "Body Metrics", icon: Scale },
  { num: 5, label: "Schedule", icon: CalendarDays },
];

// ── Helper Components ────────────────────────────────────────

function StepIndicator({
  current,
  steps,
}: {
  current: number;
  steps: typeof STEPS;
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
              <div
                className={`h-px w-4 sm:w-8 ${
                  isDone ? "bg-primary" : "bg-muted"
                }`}
              />
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
  nextLabel = "Next",
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
  return (
    <div className="flex items-center justify-between pt-6 border-t mt-8">
      <div>
        {onBack && (
          <Button variant="outline" size="sm" onClick={onBack}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {onSkip && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onSkip}
            disabled={saving}
          >
            <SkipForward className="h-4 w-4 mr-1" /> Skip
          </Button>
        )}
        {onNext && (
          <Button
            size="sm"
            onClick={onNext}
            disabled={!canNext || saving}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />{" "}
                Saving...
              </>
            ) : (
              <>
                {nextLabel}{" "}
                <ChevronRight className="h-4 w-4 ml-1" />
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
  const { data: session, status } = useSession();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

  // Step 1: Integration
  const [integrationType, setIntegrationType] = useState<
    "garmin" | "coros" | null
  >(null);
  const [garminConnected, setGarminConnected] = useState(false);
  const [garminEmail, setGarminEmail] = useState("");
  const [garminPassword, setGarminPassword] = useState("");
  const [garminMfaRequired, setGarminMfaRequired] = useState(false);
  const [garminMfaCode, setGarminMfaCode] = useState("");
  const [garminConnecting, setGarminConnecting] = useState(false);
  const [garminError, setGarminError] = useState<string | null>(null);
  const [garminDisplayName, setGarminDisplayName] = useState<string | null>(
    null
  );

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

  // Step 3: Facilities
  const [facilityCount, setFacilityCount] = useState(0);
  const [showFacilityForm, setShowFacilityForm] = useState(false);
  const [facilityName, setFacilityName] = useState("");
  const [facilityType, setFacilityType] = useState("road");
  const [facilitySaving, setFacilitySaving] = useState(false);

  // Step 4: Goal
  const [goalName, setGoalName] = useState("");
  const [goalRaceType, setGoalRaceType] = useState("road_run");
  const [goalTargetDate, setGoalTargetDate] = useState("");
  const [goalDistance, setGoalDistance] = useState("");
  const [goalElevation, setGoalElevation] = useState("");
  const [goalPriority, setGoalPriority] = useState("B");
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalSaved, setGoalSaved] = useState(false);

  // Step 5: Body Metrics
  const [metricDate, setMetricDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [metricWeight, setMetricWeight] = useState("");
  const [metricHeight, setMetricHeight] = useState("");
  const [metricRestingHr, setMetricRestingHr] = useState("");
  const [metricSaving, setMetricSaving] = useState(false);
  const [metricSaved, setMetricSaved] = useState(false);

  // Step 6: Schedule
  const [scheduleSlots, setScheduleSlots] = useState<
    Array<{ day: number; start: string; end: string }>
  >([]);
  const [scheduleSaving, setScheduleSaving] = useState(false);

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

  // Init schedule slots with default every day at 06:00-07:00
  useEffect(() => {
    if (scheduleSlots.length === 0) {
      setScheduleSlots(
        Array.from({ length: 7 }, (_, i) => ({
          day: i,
          start: "06:00",
          end: "07:00",
        }))
      );
    }
  }, [scheduleSlots.length]);

  if (pageLoading || status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
        setGarminError(
          "Multi-factor authentication is enabled. Enter the code from your authenticator app or email."
        );
      } else {
        setGarminError(data.error || "Connection failed");
      }
    } catch {
      setGarminError("Network error — check your connection");
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
        setCorosError(data.error || "Connection failed");
      }
    } catch {
      setCorosError("Network error — check your connection");
    } finally {
      setCorosConnecting(false);
    }
  };

  const handleSaveReviewAndAnalysis = async () => {
    setSaving(true);
    try {
      await Promise.all([
        fetch("/api/settings/review-schedule", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reviewDayOfWeek: Number(reviewDay),
            reviewTime,
          }),
        }),
        fetch("/api/settings/analysis", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            analysisTrigger,
            analysisTriggerValue,
          }),
        }),
      ]);
    } catch {
      // Continue even on error
    }
    setSaving(false);
    setCurrentStep(2);
  };

  const handleAddFacility = async () => {
    if (!facilityName.trim()) return;
    setFacilitySaving(true);
    try {
      const res = await fetch("/api/facilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: facilityName, type: facilityType }),
      });
      if (res.ok) {
        setFacilityCount((c) => c + 1);
        setFacilityName("");
        setFacilityType("road");
        setShowFacilityForm(false);
      }
    } catch {
      // Ignore
    }
    setFacilitySaving(false);
  };

  const handleSaveGoal = async () => {
    if (!goalName.trim() || !goalTargetDate || !goalDistance) return;
    setGoalSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: goalName,
        raceType: goalRaceType,
        targetDate: goalTargetDate,
        distanceMeters: Number(goalDistance),
      };
      if (goalElevation) body.elevationGainMeters = Number(goalElevation);
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
    } catch {
      // Ignore
    }
    setMetricSaving(false);
  };

  const handleSaveSchedule = async () => {
    setScheduleSaving(true);
    try {
      // Save each slot individually
      await Promise.all(
        scheduleSlots.map((slot) =>
          fetch("/api/availability", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dayOfWeek: slot.day,
              startTime: slot.start,
              endTime: slot.end,
            }),
          })
        )
      );
    } catch {
      // Continue
    }
    setScheduleSaving(false);
    setCurrentStep(6); // completion
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/onboarding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createDefaultFacility: true }),
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
    if (!confirm("Skip the setup wizard? You can configure everything later from Settings.")) return;
    setSaving(true);
    try {
      await fetch("/api/settings/onboarding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createDefaultFacility: true }),
      });
      router.push("/dashboard");
    } catch {
      // Ignore
    }
    setSaving(false);
  };

  const updateSlot = (
    day: number,
    field: "start" | "end",
    value: string
  ) => {
    setScheduleSlots((prev) =>
      prev.map((s) => (s.day === day ? { ...s, [field]: value } : s))
    );
  };

  const removeSlot = (day: number) => {
    setScheduleSlots((prev) => prev.filter((s) => s.day !== day));
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
              <h1 className="text-2xl font-bold mb-2">
                Connect Your Watch
              </h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Sync your training data automatically by connecting your
                wearable account. Choose one or skip — you can set this up
                later.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {/* COROS Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Watch className="h-5 w-5" /> COROS Training Hub
                  </CardTitle>
                  <CardDescription>
                    Sync activities from your COROS watch
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {corosConnected ? (
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="font-medium">Connected</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <XCircle className="h-4 w-4" />
                        <span className="text-sm">Not connected</span>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="coros-email" className="text-xs">
                          Email
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
                        <Label
                          htmlFor="coros-password"
                          className="text-xs"
                        >
                          Password
                        </Label>
                        <Input
                          id="coros-password"
                          type="password"
                          value={corosPassword}
                          onChange={(e) =>
                            setCorosPassword(e.target.value)
                          }
                          placeholder="COROS password"
                          disabled={corosConnecting}
                        />
                      </div>
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={handleCorosConnect}
                        disabled={
                          corosConnecting ||
                          !corosEmail ||
                          !corosPassword
                        }
                      >
                        {corosConnecting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />{" "}
                            Connecting...
                          </>
                        ) : (
                          <>
                            <Plug className="h-4 w-4 mr-1" /> Connect
                            COROS
                          </>
                        )}
                      </Button>
                      {corosError && (
                        <p className="text-xs text-destructive">
                          {corosError}
                        </p>
                      )}
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
                  <CardDescription>
                    Sync activities + health data from Garmin
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {garminConnected ? (
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="font-medium">Connected</span>
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
                        <span className="text-sm">Not connected</span>
                      </div>
                      <div className="space-y-1.5">
                        <Label
                          htmlFor="garmin-email"
                          className="text-xs"
                        >
                          Email
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
                        <Label
                          htmlFor="garmin-password"
                          className="text-xs"
                        >
                          Password
                        </Label>
                        <Input
                          id="garmin-password"
                          type="password"
                          value={garminPassword}
                          onChange={(e) =>
                            setGarminPassword(e.target.value)
                          }
                          placeholder="Garmin password"
                          disabled={garminConnecting || garminMfaRequired}
                        />
                      </div>
                      {garminMfaRequired && (
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="garmin-mfa"
                            className="text-xs"
                          >
                            MFA Code
                          </Label>
                          <Input
                            id="garmin-mfa"
                            type="text"
                            value={garminMfaCode}
                            onChange={(e) =>
                              setGarminMfaCode(e.target.value)
                            }
                            placeholder="6-digit code"
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
                            Connecting...
                          </>
                        ) : (
                          <>
                            <Plug className="h-4 w-4 mr-1" /> Connect
                            Garmin
                          </>
                        )}
                      </Button>
                      {garminError && (
                        <p className="text-xs text-destructive">
                          {garminError}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <ExplanationCard>
              Syncing your watch auto-imports activities so you don&apos;t
              have to upload files manually. Garmin also syncs daily health
              metrics like heart rate, sleep, and HRV.
            </ExplanationCard>

            <StepFooter
              onNext={() => setCurrentStep(1)}
              onSkip={() => setCurrentStep(1)}
              canNext
            />
          </div>
        );

      // ── Step 1: Review & Analysis ──
      case 1:
        return (
          <div>
            <div className="text-center mb-8">
              <Brain className="h-10 w-10 text-primary mx-auto mb-4" />
              <h1 className="text-2xl font-bold mb-2">
                Schedule Your Training Review
              </h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Set when the AI Coach analyzes your training and generates
                insights and next week&apos;s plan.
              </p>
            </div>

            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarDays className="h-4 w-4" /> Weekly Review
                  Schedule
                </CardTitle>
                <CardDescription>
                  When the AI analyzes your training and generates next
                  week&apos;s plan
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Day of Week</Label>
                    <Select
                      value={reviewDay}
                      onValueChange={setReviewDay}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DAY_NAMES.map((d, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Time</Label>
                    <Input
                      type="time"
                      value={reviewTime}
                      onChange={(e) => setReviewTime(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Brain className="h-4 w-4" /> Analysis Frequency
                </CardTitle>
                <CardDescription>
                  How often the AI Coach generates fresh analysis
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Select
                    value={analysisTrigger}
                    onValueChange={setAnalysisTrigger}
                  >
                    <SelectTrigger className="max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="activity_count">
                        After every N activities
                      </SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">
                        Weekly (on review day)
                      </SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                  {analysisTrigger === "activity_count" && (
                    <div className="flex items-center gap-2 pt-2">
                      <Label>Every</Label>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        value={analysisTriggerValue}
                        onChange={(e) =>
                          setAnalysisTriggerValue(
                            Math.max(
                              1,
                              Math.min(20, Number(e.target.value))
                            )
                          )
                        }
                        className="w-20"
                      />
                      <span className="text-sm text-muted-foreground">
                        activit{analysisTriggerValue === 1 ? "y" : "ies"}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <ExplanationCard>
              The AI Coach reviews your training logs, fatigue, readiness,
              and goal progress on this schedule. It generates personalized
              coach notes and adjusts your weekly plan. Weekly is
              recommended for most athletes.
            </ExplanationCard>

            <StepFooter
              onBack={() => setCurrentStep(0)}
              onNext={handleSaveReviewAndAnalysis}
              canNext
              saving={saving}
            />
          </div>
        );

      // ── Step 2: Facilities ──
      case 2:
        return (
          <div>
            <div className="text-center mb-8">
              <Dumbbell className="h-10 w-10 text-primary mx-auto mb-4" />
              <h1 className="text-2xl font-bold mb-2">
                Set Up Your Training Locations
              </h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Tell the planner what facilities you have access to for
                better route recommendations.
              </p>
            </div>

            <Card className="mb-4 border-primary/50 bg-primary/5">
              <CardContent className="p-4 flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">
                    &ldquo;Road Running&rdquo; facility will be added
                    automatically
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    This gives the planner a default road-running context
                    for route recommendations.
                  </p>
                </div>
              </CardContent>
            </Card>

            {showFacilityForm && (
              <Card className="mb-4">
                <CardHeader>
                  <CardTitle className="text-base">
                    Add Another Facility
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid sm:grid-cols-2 gap-3 mb-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="fac-name" className="text-xs">
                        Name
                      </Label>
                      <Input
                        id="fac-name"
                        value={facilityName}
                        onChange={(e) =>
                          setFacilityName(e.target.value)
                        }
                        placeholder="e.g. Riverside Trail"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="fac-type" className="text-xs">
                        Type
                      </Label>
                      <Select
                        value={facilityType}
                        onValueChange={setFacilityType}
                      >
                        <SelectTrigger id="fac-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="road">Road</SelectItem>
                          <SelectItem value="trail">Trail</SelectItem>
                          <SelectItem value="track">Track</SelectItem>
                          <SelectItem value="trainer">Trainer</SelectItem>
                          <SelectItem value="pool">Pool</SelectItem>
                          <SelectItem value="gym">Gym</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleAddFacility}
                      disabled={facilitySaving || !facilityName.trim()}
                    >
                      {facilitySaving ? "Adding..." : "Add Facility"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowFacilityForm(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {!showFacilityForm && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFacilityForm(true)}
                className="mb-4"
              >
                <Plus className="h-4 w-4 mr-1" /> Add Another Facility
              </Button>
            )}

            {facilityCount > 0 && (
              <p className="text-sm text-muted-foreground mb-4">
                {facilityCount} additional facilit
                {facilityCount === 1 ? "y" : "ies"} added.
              </p>
            )}

            <ExplanationCard>
              Facilities help the training planner recommend routes suited
              to your terrain — road runs, trail runs, track sessions, or
              pool workouts. The default &ldquo;Road Running&rdquo; facility
              ensures plan recommendations match your primary training
              surface.
            </ExplanationCard>

            <StepFooter
              onBack={() => setCurrentStep(1)}
              onNext={() => setCurrentStep(3)}
              canNext
            />
          </div>
        );

      // ── Step 3: Goals ──
      case 3:
        return (
          <div>
            <div className="text-center mb-8">
              <Target className="h-10 w-10 text-primary mx-auto mb-4" />
              <h1 className="text-2xl font-bold mb-2">
                Set Your First Goal
              </h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Tell the coach what you&apos;re training for. You can
                always add more goals or adjust later.
              </p>
            </div>

            {goalSaved ? (
              <Card className="mb-4 border-green-300 bg-green-50 dark:bg-green-950/20">
                <CardContent className="p-6 text-center">
                  <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="font-medium text-green-700 dark:text-green-300">
                    Goal saved!
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    You can add more goals from the Settings page later.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="mb-4">
                <CardHeader>
                  <CardTitle className="text-base">New Goal</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="goal-name" className="text-xs">
                        Goal Name
                      </Label>
                      <Input
                        id="goal-name"
                        value={goalName}
                        onChange={(e) => setGoalName(e.target.value)}
                        placeholder="e.g. Chicago Marathon"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="goal-type" className="text-xs">
                        Race Type
                      </Label>
                      <Select
                        value={goalRaceType}
                        onValueChange={setGoalRaceType}
                      >
                        <SelectTrigger id="goal-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RACE_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="goal-date" className="text-xs">
                        Target Date
                      </Label>
                      <Input
                        id="goal-date"
                        type="date"
                        value={goalTargetDate}
                        onChange={(e) =>
                          setGoalTargetDate(e.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="goal-distance" className="text-xs">
                        Distance (meters)
                      </Label>
                      <Input
                        id="goal-distance"
                        type="number"
                        min="0"
                        value={goalDistance}
                        onChange={(e) => setGoalDistance(e.target.value)}
                        placeholder="e.g. 42195"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="goal-elevation"
                        className="text-xs"
                      >
                        Elevation Gain (meters, optional)
                      </Label>
                      <Input
                        id="goal-elevation"
                        type="number"
                        min="0"
                        value={goalElevation}
                        onChange={(e) =>
                          setGoalElevation(e.target.value)
                        }
                        placeholder="e.g. 500"
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="mt-4"
                    onClick={handleSaveGoal}
                    disabled={
                      goalSaving ||
                      !goalName.trim() ||
                      !goalTargetDate ||
                      !goalDistance
                    }
                  >
                    {goalSaving ? "Saving..." : "Save Goal"}
                  </Button>
                </CardContent>
              </Card>
            )}

            <ExplanationCard>
              Setting goals powers the AI coach&apos;s race readiness
              analysis — it tracks your training trajectory against the
              target and tells you if you&apos;re on pace, need more work,
              or are falling behind. You can always add more goals later.
            </ExplanationCard>

            <StepFooter
              onBack={() => setCurrentStep(2)}
              onNext={() => setCurrentStep(4)}
              onSkip={() => {
                setGoalSaved(true);
                setCurrentStep(4);
              }}
              canNext
            />
          </div>
        );

      // ── Step 4: Body Metrics ──
      case 4:
        return (
          <div>
            <div className="text-center mb-8">
              <Scale className="h-10 w-10 text-primary mx-auto mb-4" />
              <h1 className="text-2xl font-bold mb-2">
                Track Your Body Metrics
              </h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Enter your current weight and optional body stats to
                improve analysis accuracy.
              </p>
            </div>

            {metricSaved ? (
              <Card className="mb-4 border-green-300 bg-green-50 dark:bg-green-950/20">
                <CardContent className="p-6 text-center">
                  <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="font-medium text-green-700 dark:text-green-300">
                    Body metrics saved!
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="mb-4">
                <CardHeader>
                  <CardTitle className="text-base">
                    Body Metrics Entry
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="metric-date" className="text-xs">
                        Date
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
                        Weight (kg) *
                      </Label>
                      <Input
                        id="metric-weight"
                        type="number"
                        min="20"
                        max="500"
                        step="0.1"
                        value={metricWeight}
                        onChange={(e) =>
                          setMetricWeight(e.target.value)
                        }
                        placeholder="e.g. 75.5"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="metric-height" className="text-xs">
                        Height (cm, optional)
                      </Label>
                      <Input
                        id="metric-height"
                        type="number"
                        min="100"
                        max="250"
                        value={metricHeight}
                        onChange={(e) =>
                          setMetricHeight(e.target.value)
                        }
                        placeholder="e.g. 175"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="metric-resting-hr"
                        className="text-xs"
                      >
                        Resting HR (bpm, optional)
                      </Label>
                      <Input
                        id="metric-resting-hr"
                        type="number"
                        min="30"
                        max="220"
                        value={metricRestingHr}
                        onChange={(e) =>
                          setMetricRestingHr(e.target.value)
                        }
                        placeholder="e.g. 62"
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="mt-4"
                    onClick={handleSaveBodyMetric}
                    disabled={metricSaving || !metricWeight}
                  >
                    {metricSaving ? "Saving..." : "Save Entry"}
                  </Button>
                </CardContent>
              </Card>
            )}

            <ExplanationCard>
              Body weight is used to calculate relative intensity metrics
              (e.g., watts/kg, VO₂ estimates). Tracking your resting heart
              rate helps detect fatigue trends. Even a one-time entry
              improves your analysis.
            </ExplanationCard>

            <StepFooter
              onBack={() => setCurrentStep(3)}
              onNext={() => setCurrentStep(5)}
              onSkip={() => {
                setMetricSaved(true);
                setCurrentStep(5);
              }}
              canNext
            />
          </div>
        );

      // ── Step 5: Schedule ──
      case 5:
        return (
          <div>
            <div className="text-center mb-8">
              <CalendarDays className="h-10 w-10 text-primary mx-auto mb-4" />
              <h1 className="text-2xl font-bold mb-2">
                Set Your Weekly Schedule
              </h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Tell the planner when you&apos;re available to train.
                We&apos;ve added a default slot for every day.
              </p>
            </div>

            <div className="space-y-3 mb-4">
              {DAY_NAMES.map((dayName, dayIndex) => {
                const slot = scheduleSlots.find((s) => s.day === dayIndex);
                if (!slot) return null;
                return (
                  <Card key={dayIndex}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <span className="font-medium text-sm w-24 shrink-0">
                        {dayName.slice(0, 3)}
                      </span>
                      <div className="flex items-center gap-2 flex-1">
                        <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                        <Input
                          type="time"
                          value={slot.start}
                          onChange={(e) =>
                            updateSlot(dayIndex, "start", e.target.value)
                          }
                          className="w-28"
                        />
                        <span className="text-muted-foreground">&ndash;</span>
                        <Input
                          type="time"
                          value={slot.end}
                          onChange={(e) =>
                            updateSlot(dayIndex, "end", e.target.value)
                          }
                          className="w-28"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-destructive h-8 w-8"
                        onClick={() => removeSlot(dayIndex)}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Remove {dayName}</span>
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <ExplanationCard>
              The training planner needs to know when you&apos;re available
              to schedule workouts. We&apos;ve added a default 6-7 AM slot
              for every day — adjust to match your real availability. You
              can add more slots per day from Settings later.
            </ExplanationCard>

            <StepFooter
              onBack={() => setCurrentStep(4)}
              onNext={handleSaveSchedule}
              canNext={scheduleSlots.length > 0}
              nextLabel="Save Schedule"
              saving={scheduleSaving}
            />
          </div>
        );

      // ── Step 6: Completion ──
      case 6:
        return (
          <div className="text-center">
            <div className="mb-6">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Check className="h-8 w-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold mb-2">
                You&apos;re All Set!
              </h1>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Here&apos;s what you&apos;ve configured so you can hit the
                ground running.
              </p>
            </div>

            <div className="max-w-md mx-auto text-left space-y-3 mb-8">
              <SummaryItem
                icon={integrationType ? CheckCircle2 : XCircle}
                label="Wearable Integration"
                detail={
                  integrationType
                    ? `${integrationType === "garmin" ? "Garmin" : "COROS"} connected`
                    : "Skipped — set up later"
                }
                done={!!integrationType}
              />
              <SummaryItem
                icon={Check}
                label="Review Schedule"
                detail={`${DAY_NAMES[Number(reviewDay)]} at ${reviewTime}`}
                done
              />
              <SummaryItem
                icon={Check}
                label="Analysis Frequency"
                detail={
                  analysisTrigger === "activity_count"
                    ? `Every ${analysisTriggerValue} activities`
                    : analysisTrigger
                }
                done
              />
              <SummaryItem
                icon={Check}
                label="Facility"
                detail='Default "Road Running" + yours'
                done
              />
              <SummaryItem
                icon={goalSaved ? Check : XCircle}
                label="Race Goal"
                detail={goalSaved ? goalName : "Skipped"}
                done={goalSaved}
              />
              <SummaryItem
                icon={metricSaved ? Check : XCircle}
                label="Body Metrics"
                detail={metricSaved ? "Logged today" : "Skipped"}
                done={metricSaved}
              />
              <SummaryItem
                icon={Check}
                label="Training Schedule"
                detail={`${scheduleSlots.length} day${scheduleSlots.length > 1 ? "s" : ""} configured`}
                done
              />
            </div>

            <Button size="lg" onClick={handleComplete} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />{" "}
                  Finalizing...
                </>
              ) : (
                <>
                  Go to Dashboard{" "}
                  <ChevronRight className="h-5 w-5 ml-1" />
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
        {currentStep < 6 && <StepIndicator current={currentStep} steps={STEPS} />}

        <div className="min-h-[400px]">{renderStep()}</div>

        {/* Dismiss link — shown on all wizard steps except completion */}
        {currentStep < 6 && (
          <div className="text-center mt-6">
            <button
              onClick={handleDismiss}
              disabled={saving}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors disabled:opacity-50"
            >
              Skip setup, go to dashboard
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
      <Icon
        className={`h-5 w-5 shrink-0 ${done ? "text-green-500" : "text-muted-foreground"}`}
      />
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">{detail}</p>
      </div>
    </div>
  );
}
