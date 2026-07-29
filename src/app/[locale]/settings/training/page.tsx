"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDistance, cn } from "@/lib/utils";
import { format, differenceInDays } from "date-fns";
import {
  MapPin, Plus, Pencil, Trash2, Target, Calendar, Mountain, Route,
  Scale, Heart, TrendingDown, TrendingUp, AlertCircle, Check,
} from "lucide-react";

// ─── Goal Types ────────────────────────────────────────────────────────────
interface RaceGoal {
  id: string; name: string; raceType: string; targetDate: string;
  distanceMeters: number; elevationGainMeters: number | null;
  targetTimeSeconds: number | null; priority: "A" | "B" | "C"; status: string; notes: string | null;
  goalStatement: string | null;
}

interface GoalFormData {
  name: string; raceType: string; targetDate: string; distanceMeters: string;
  elevationGainMeters: string; priority: string; notes: string; goalStatement: string;
}

const DEFAULT_GOAL_FORM: GoalFormData = {
  name: "", raceType: "trail_run", targetDate: "", distanceMeters: "",
  elevationGainMeters: "", priority: "B", notes: "", goalStatement: "",
};

// ─── Body Metric Types ─────────────────────────────────────────────────────
interface BodyMetric {
  id: string; recordedAt: string; weightKg: number;
  heightCm: number | null; restingHr: number | null; notes: string | null;
}

interface BmFormData {
  recordedAt: string; weightKg: string; heightCm: string;
  restingHr: string; notes: string;
}

const DEFAULT_BM_FORM: BmFormData = {
  recordedAt: new Date().toISOString().slice(0, 10),
  weightKg: "", heightCm: "", restingHr: "", notes: "",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function avgWeight(metrics: BodyMetric[]): number | null {
  if (metrics.length === 0) return null;
  const sum = metrics.reduce((acc, m) => acc + m.weightKg, 0);
  return Math.round((sum / metrics.length) * 10) / 10;
}

// ─── Section: Training Context ─────────────────────────────────────────────
function TrainingContextSection({ t, common }: { t: ReturnType<typeof useTranslations>; common: ReturnType<typeof useTranslations> }) {
  const { status } = useSession();
  const [tc, setTc] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/settings/training-context")
      .then((r) => r.json())
      .then((data) => { setTc(data.trainingContext || ""); setLoading(false); })
      .catch(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    return () => { if (savedTimer.current) clearTimeout(savedTimer.current); };
  }, []);

  async function handleSave() {
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await fetch("/api/settings/training-context", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trainingContext: tc }),
      });
      if (!res.ok) throw new Error("Failed");
      setSaved(true);
      savedTimer.current = setTimeout(() => setSaved(false), 3000);
    } catch { setError(t("contextSaveFailed")); }
    setSaving(false);
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5" /> {t("trainingContextTitle")}</CardTitle>
        <CardDescription>{t("trainingContextDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">{common("loading")}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="training-context">{t("trainingContextLabel")}</Label>
              <Textarea id="training-context" rows={4}
                placeholder={t("trainingContextPlaceholder")}
                value={tc} onChange={(e) => setTc(e.target.value)}
              />
            </div>
            {error && <div className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span></div>}
            {saved && <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400"><Check className="h-4 w-4 shrink-0" /><span>{t("contextSaved")}</span></div>}
            <Button onClick={handleSave} disabled={saving}>{saving ? common("saving") : common("save")}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: Goals ────────────────────────────────────────────────────────
function GoalsSection({ t, common }: { t: ReturnType<typeof useTranslations>; common: ReturnType<typeof useTranslations> }) {
  const [goalList, setGoalList] = useState<RaceGoal[]>([]);
  const [gShowForm, setGShowForm] = useState(false);
  const [gEditingId, setGEditingId] = useState<string | null>(null);
  const [gLoading, setGLoading] = useState(true);
  const [gForm, setGForm] = useState<GoalFormData>(DEFAULT_GOAL_FORM);

  const fetchGoals = useCallback(async () => {
    const res = await fetch("/api/goals");
    setGoalList(await res.json());
    setGLoading(false);
  }, []);

  useEffect(() => { fetchGoals(); }, [fetchGoals]);

  function resetForm() {
    setGForm(DEFAULT_GOAL_FORM);
    setGShowForm(false);
    setGEditingId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      name: gForm.name, raceType: gForm.raceType,
      targetDate: new Date(gForm.targetDate).toISOString(),
      distanceMeters: Number(gForm.distanceMeters),
      elevationGainMeters: gForm.elevationGainMeters ? Number(gForm.elevationGainMeters) : null,
      priority: gForm.priority, notes: gForm.notes || null, goalStatement: gForm.goalStatement || null,
    };
    if (gEditingId) {
      await fetch(`/api/goals/${gEditingId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } else {
      await fetch("/api/goals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    resetForm(); fetchGoals();
  }

  function startEdit(goal: RaceGoal) {
    setGForm({
      name: goal.name, raceType: goal.raceType, targetDate: goal.targetDate.split("T")[0],
      distanceMeters: String(goal.distanceMeters),
      elevationGainMeters: goal.elevationGainMeters ? String(goal.elevationGainMeters) : "",
      priority: goal.priority, notes: goal.notes || "", goalStatement: goal.goalStatement || "",
    });
    setGEditingId(goal.id); setGShowForm(true);
  }

  async function deleteGoal(id: string) {
    if (!confirm(t("deleteConfirm"))) return;
    await fetch(`/api/goals/${id}`, { method: "DELETE" });
    fetchGoals();
  }

  const statusLabels: Record<string, string> = { active: t("statusActive"), completed: t("statusCompleted") };

  if (gLoading) return <p className="py-4 text-sm text-muted-foreground">{common("loading")}</p>;

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Target className="h-5 w-5" /> {t("title")}</CardTitle>
          <Button size="sm" onClick={() => { resetForm(); setGShowForm(true); }}><Plus className="h-4 w-4 mr-1" /> {t("addGoal")}</Button>
        </div>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Goal form */}
        {gShowForm && (
          <div className="mb-6 p-4 rounded-lg border bg-muted/30">
            <h4 className="font-medium mb-4">{gEditingId ? t("editGoal") : t("newGoal")}</h4>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2"><Label>{t("name")}</Label><Input value={gForm.name} onChange={(e) => setGForm({ ...gForm, name: e.target.value })} placeholder="Ultra Trail 100km" required /></div>
                <div className="space-y-2"><Label>{t("raceType")}</Label>
                  <Select value={gForm.raceType} onValueChange={(v) => setGForm({ ...gForm, raceType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="trail_run">{t("raceType_trail_run")}</SelectItem>
                      <SelectItem value="road_run">{t("raceType_road_run")}</SelectItem>
                      <SelectItem value="marathon">{t("raceType_marathon")}</SelectItem>
                      <SelectItem value="ultra">{t("raceType_ultra")}</SelectItem>
                      <SelectItem value="triathlon">{t("raceType_triathlon")}</SelectItem>
                      <SelectItem value="cycling">{t("raceType_cycling")}</SelectItem>
                      <SelectItem value="other">{t("raceType_other")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>{t("targetDate")}</Label><Input type="date" value={gForm.targetDate} onChange={(e) => setGForm({ ...gForm, targetDate: e.target.value })} required /></div>
                <div className="space-y-2"><Label>{t("priority")}</Label>
                  <Select value={gForm.priority} onValueChange={(v) => setGForm({ ...gForm, priority: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">{t("priorityA")}</SelectItem>
                      <SelectItem value="B">{t("priorityB")}</SelectItem>
                      <SelectItem value="C">{t("priorityC")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>{t("distance")}</Label><Input type="number" value={gForm.distanceMeters} onChange={(e) => setGForm({ ...gForm, distanceMeters: e.target.value })} placeholder="100000" required /></div>
                <div className="space-y-2"><Label>{t("elevationGain")}</Label><Input type="number" value={gForm.elevationGainMeters} onChange={(e) => setGForm({ ...gForm, elevationGainMeters: e.target.value })} placeholder="6000" /></div>
                <div className="space-y-2"><Label>{t("notes")}</Label><Input value={gForm.notes} onChange={(e) => setGForm({ ...gForm, notes: e.target.value })} placeholder={t("notesPlaceholder")} /></div>
                <div className="space-y-2 md:col-span-2"><Label>{t("goalStatement")}</Label><Textarea value={gForm.goalStatement} onChange={(e) => setGForm({ ...gForm, goalStatement: e.target.value })} placeholder={t("goalStatementPlaceholder")} rows={2} /></div>
              </div>
              <div className="flex gap-2"><Button type="submit">{gEditingId ? common("update") : common("create")}</Button><Button type="button" variant="outline" onClick={resetForm}>{common("cancel")}</Button></div>
            </form>
          </div>
        )}

        {/* Goal list */}
        {goalList.length === 0 ? (
          <div className="py-8 text-center">
            <Target className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h4 className="font-semibold mb-1">{t("noGoals")}</h4>
            <p className="text-sm text-muted-foreground mb-4">{t("noGoalsDesc")}</p>
            <Button size="sm" onClick={() => setGShowForm(true)}><Plus className="h-4 w-4 mr-1" /> {t("addFirstGoal")}</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {goalList.map((goal) => {
              const daysUntil = differenceInDays(new Date(goal.targetDate), new Date());
              return (
                <div key={goal.id} className="flex items-start justify-between gap-2 p-3 rounded-lg border hover:shadow-sm transition-shadow">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Link href={`/settings/goals/${goal.id}`} className="font-semibold hover:text-primary text-sm">{goal.name}</Link>
                      <Badge variant={goal.priority === "A" ? "destructive" : goal.priority === "B" ? "default" : "secondary"} className="text-[10px]">{t("priorityBadge", { priority: goal.priority })}</Badge>
                      <Badge variant="outline" className="text-[10px]">{statusLabels[goal.status] || goal.status}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Route className="h-3 w-3" /> {formatDistance(goal.distanceMeters)}</span>
                      {goal.elevationGainMeters ? <span className="flex items-center gap-1"><Mountain className="h-3 w-3" /> {formatDistance(goal.elevationGainMeters)}</span> : null}
                      <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {format(new Date(goal.targetDate), "MMM d, yyyy")}</span>
                      <span className={daysUntil < 30 ? "text-destructive font-medium" : ""}>{daysUntil > 0 ? common("daysLeft", { days: daysUntil }) : common("pastDue")}</span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(goal)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteGoal(goal.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: Body Metrics ─────────────────────────────────────────────────
function BodyMetricsSection({ t, common }: { t: ReturnType<typeof useTranslations>; common: ReturnType<typeof useTranslations> }) {
  const [bmMetrics, setBmMetrics] = useState<BodyMetric[]>([]);
  const [bmLoading, setBmLoading] = useState(true);
  const [bmError, setBmError] = useState<string | null>(null);
  const [bmShowForm, setBmShowForm] = useState(false);
  const [bmForm, setBmForm] = useState<BmFormData>(DEFAULT_BM_FORM);
  const [bmSaving, setBmSaving] = useState(false);
  const [bmDelConfirm, setBmDelConfirm] = useState<string | null>(null);
  const [bmDeleting, setBmDeleting] = useState(false);

  const fetchBm = useCallback(async () => {
    try {
      setBmLoading(true); setBmError(null);
      const res = await fetch("/api/body-metrics");
      if (!res.ok) throw new Error("Failed");
      setBmMetrics(await res.json());
    } catch (err) {
      setBmError(err instanceof Error ? err.message : "Something went wrong");
    } finally { setBmLoading(false); }
  }, []);

  useEffect(() => { fetchBm(); }, [fetchBm]);

  const bmSorted = [...bmMetrics].sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
  const latestWeight = bmSorted[0]?.weightKg ?? null;
  const bmAvg = avgWeight(bmSorted);

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentEnough = bmSorted.filter((m) => new Date(m.recordedAt).getTime() >= sevenDaysAgo);
  const weekChange = recentEnough.length >= 2
    ? Math.round((recentEnough[0].weightKg - recentEnough[recentEnough.length - 1].weightKg) * 10) / 10
    : null;
  const weightTrend = weekChange !== null ? (weekChange > 0 ? "up" : weekChange < 0 ? "down" : "stable") : null;

  async function handleBmSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBmSaving(true); setBmError(null);
    try {
      const body: Record<string, unknown> = { recordedAt: bmForm.recordedAt, weightKg: Number(bmForm.weightKg) };
      if (bmForm.heightCm) body.heightCm = Number(bmForm.heightCm);
      if (bmForm.restingHr) body.restingHr = Number(bmForm.restingHr);
      if (bmForm.notes) body.notes = bmForm.notes;
      const res = await fetch("/api/body-metrics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error ?? "Failed"); }
      await fetchBm();
      setBmForm(DEFAULT_BM_FORM); setBmShowForm(false);
    } catch (err) { setBmError(err instanceof Error ? err.message : "Something went wrong"); }
    finally { setBmSaving(false); }
  }

  async function handleBmDelete(id: string) {
    setBmDeleting(true);
    try {
      const res = await fetch(`/api/body-metrics/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      setBmMetrics((prev) => prev.filter((m) => m.id !== id));
      setBmDelConfirm(null);
    } catch { /* ignore */ }
    finally { setBmDeleting(false); }
  }

  if (bmLoading) return <p className="py-4 text-sm text-muted-foreground">{common("loading")}</p>;

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5" /> {t("title")}</CardTitle>
          <Button size="sm" onClick={() => { setBmForm(DEFAULT_BM_FORM); setBmShowForm(true); }} disabled={bmShowForm}><Plus className="h-4 w-4 mr-1" /> {t("addEntry")}</Button>
        </div>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {bmError && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded mb-4">{bmError}</div>}

        {/* Stats */}
        <div className="grid gap-3 sm:grid-cols-3 mb-6">
          <div className="p-3 rounded-lg border">
            <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><Scale className="h-3 w-3" /> {t("latestWeight")}</p>
            <p className="text-xl font-bold">{latestWeight != null ? `${latestWeight.toFixed(1)} ${t("unitKg")}` : "—"}</p>
          </div>
          <div className="p-3 rounded-lg border">
            <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
              {weightTrend === "up" ? <TrendingUp className="h-3 w-3 text-destructive" /> : weightTrend === "down" ? <TrendingDown className="h-3 w-3 text-green-500" /> : <Heart className="h-3 w-3" />}
              {t("sevenDayChange")}
            </p>
            <p className={cn("text-xl font-bold", weekChange !== null && weekChange > 0 && "text-destructive", weekChange !== null && weekChange < 0 && "text-green-500")}>
              {weekChange !== null ? `${weekChange > 0 ? "+" : ""}${weekChange.toFixed(1)} ${t("unitKg")}` : "—"}
            </p>
          </div>
          <div className="p-3 rounded-lg border">
            <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><Heart className="h-3 w-3" /> {t("averageWeight")}</p>
            <p className="text-xl font-bold">{bmAvg != null ? `${bmAvg.toFixed(1)} ${t("unitKg")}` : "—"}</p>
          </div>
        </div>

        {/* Add form */}
        {bmShowForm && (
          <div className="mb-6 p-4 rounded-lg border bg-muted/30">
            <h4 className="font-medium mb-4">{t("newEntry")}</h4>
            <form onSubmit={handleBmSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>{t("date")}</Label><Input type="date" value={bmForm.recordedAt} onChange={(e) => setBmForm({ ...bmForm, recordedAt: e.target.value })} required /></div>
                <div className="space-y-2"><Label>{t("formWeight")}</Label><Input type="number" step="0.1" min="20" max="500" value={bmForm.weightKg} onChange={(e) => setBmForm({ ...bmForm, weightKg: e.target.value })} required /></div>
                <div className="space-y-2"><Label>{t("formHeight")}</Label><Input type="number" min="100" max="250" value={bmForm.heightCm} onChange={(e) => setBmForm({ ...bmForm, heightCm: e.target.value })} /></div>
                <div className="space-y-2"><Label>{t("formRestingHr")}</Label><Input type="number" min="30" max="220" value={bmForm.restingHr} onChange={(e) => setBmForm({ ...bmForm, restingHr: e.target.value })} /></div>
                <div className="space-y-2 sm:col-span-2"><Label>{t("notes")}</Label><textarea rows={2} className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" value={bmForm.notes} onChange={(e) => setBmForm({ ...bmForm, notes: e.target.value })} /></div>
              </div>
              <div className="flex gap-2"><Button type="submit" disabled={bmSaving || !bmForm.weightKg}>{bmSaving ? common("saving") : t("saveEntry")}</Button><Button type="button" variant="outline" onClick={() => { setBmShowForm(false); setBmForm(DEFAULT_BM_FORM); }}>{common("cancel")}</Button></div>
            </form>
          </div>
        )}

        {/* Table */}
        {bmMetrics.length > 0 ? (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left font-medium px-3 py-2">{t("date")}</th>
                  <th className="text-left font-medium px-3 py-2">{t("tableWeight")}</th>
                  <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">{t("tableHeight")}</th>
                  <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">{t("tableRestingHr")}</th>
                  <th className="text-right font-medium px-3 py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {bmSorted.map((metric) => (
                  <tr key={metric.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(metric.recordedAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium">{metric.weightKg.toFixed(1)} {t("unitKg")}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground hidden sm:table-cell">{metric.heightCm != null ? `${metric.heightCm} ${t("unitCm")}` : "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground hidden sm:table-cell">{metric.restingHr != null ? metric.restingHr : "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {bmDelConfirm === metric.id ? (
                        <div className="flex gap-1 justify-end">
                          <Button variant="destructive" size="sm" disabled={bmDeleting} onClick={() => handleBmDelete(metric.id)}>{common("confirm")}</Button>
                          <Button variant="ghost" size="sm" onClick={() => setBmDelConfirm(null)}>{common("cancel")}</Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="sm" className="text-destructive h-7 w-7 p-0" onClick={() => setBmDelConfirm(metric.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 text-center">
            <Heart className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <h4 className="font-semibold mb-1">{t("noEntries")}</h4>
            <p className="text-sm text-muted-foreground mb-4 max-w-xs mx-auto">{t("noEntriesDesc")}</p>
            <Button size="sm" onClick={() => { setBmForm(DEFAULT_BM_FORM); setBmShowForm(true); }}><Plus className="h-4 w-4 mr-1" /> {t("addEntry")}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────
export default function SettingsTrainingPage() {
  const gt = useTranslations("settings.general");
  const goalsT = useTranslations("settings.goals");
  const bmT = useTranslations("settings.bodyMetrics");
  const common = useTranslations("common");

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Training Setup</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Define your training environment, race goals, and track your body metrics — all in one place.
        </p>
      </div>

      <TrainingContextSection t={gt} common={common} />
      <GoalsSection t={goalsT} common={common} />
      <BodyMetricsSection t={bmT} common={common} />
    </div>
  );
}
