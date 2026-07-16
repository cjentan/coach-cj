"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Target, Calendar, Mountain, Route } from "lucide-react";
import { formatDistance } from "@/lib/utils";
import { format, differenceInDays } from "date-fns";

interface RaceGoal {
  id: string; name: string; raceType: string; targetDate: string;
  distanceMeters: number; elevationGainMeters: number | null;
  targetTimeSeconds: number | null; priority: "A" | "B" | "C"; status: string; notes: string | null;
  goalStatement: string | null;
}

export default function SettingsGoalsPage() {
  const t = useTranslations("settings.goals");
  const common = useTranslations("common");

  const [goals, setGoals] = useState<RaceGoal[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    name: "", raceType: "trail_run", targetDate: "", distanceMeters: "",
    elevationGainMeters: "", priority: "B", notes: "", goalStatement: "",
  });

  const fetchGoals = useCallback(async () => {
    const res = await fetch("/api/goals");
    setGoals(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchGoals(); }, [fetchGoals]);

  function resetForm() {
    setForm({ name: "", raceType: "trail_run", targetDate: "", distanceMeters: "", elevationGainMeters: "", priority: "B", notes: "", goalStatement: "" });
    setShowForm(false); setEditingId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      name: form.name, raceType: form.raceType,
      targetDate: new Date(form.targetDate).toISOString(),
      distanceMeters: Number(form.distanceMeters),
      elevationGainMeters: form.elevationGainMeters ? Number(form.elevationGainMeters) : null,
      priority: form.priority, notes: form.notes || null, goalStatement: form.goalStatement || null,
    };
    if (editingId) {
      await fetch(`/api/goals/${editingId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } else {
      await fetch("/api/goals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    resetForm(); fetchGoals();
  }

  function startEdit(goal: RaceGoal) {
    setForm({
      name: goal.name, raceType: goal.raceType, targetDate: goal.targetDate.split("T")[0],
      distanceMeters: String(goal.distanceMeters),
      elevationGainMeters: goal.elevationGainMeters ? String(goal.elevationGainMeters) : "",
      priority: goal.priority, notes: goal.notes || "", goalStatement: goal.goalStatement || "",
    });
    setEditingId(goal.id); setShowForm(true);
  }

  async function deleteGoal(id: string) {
    if (!confirm(t("deleteConfirm"))) return;
    await fetch(`/api/goals/${id}`, { method: "DELETE" });
    fetchGoals();
  }

  if (loading) return <div className="py-8">{common("loading")}</div>;

  const statusLabels: Record<string, string> = {
    active: t("statusActive"),
    completed: t("statusCompleted"),
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("description")}</p>
        </div>
        <Button onClick={() => { resetForm(); setShowForm(true); }}><Plus className="h-4 w-4 mr-2" /> {t("addGoal")}</Button>
      </div>

      {showForm && (
        <Card className="mb-8">
          <CardHeader><CardTitle>{editingId ? t("editGoal") : t("newGoal")}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2"><Label>{t("name")}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ultra Trail 100km" required /></div>
                <div className="space-y-2"><Label>{t("raceType")}</Label>
                  <Select value={form.raceType} onValueChange={(v) => setForm({ ...form, raceType: v })}>
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
                <div className="space-y-2"><Label>{t("targetDate")}</Label><Input type="date" value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} required /></div>
                <div className="space-y-2"><Label>{t("priority")}</Label>
                  <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">{t("priorityA")}</SelectItem>
                      <SelectItem value="B">{t("priorityB")}</SelectItem>
                      <SelectItem value="C">{t("priorityC")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>{t("distance")}</Label><Input type="number" value={form.distanceMeters} onChange={(e) => setForm({ ...form, distanceMeters: e.target.value })} placeholder="100000" required /></div>
                <div className="space-y-2"><Label>{t("elevationGain")}</Label><Input type="number" value={form.elevationGainMeters} onChange={(e) => setForm({ ...form, elevationGainMeters: e.target.value })} placeholder="6000" /></div>
                <div className="space-y-2"><Label>{t("notes")}</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t("notesPlaceholder")} /></div>
                <div className="space-y-2 md:col-span-2"><Label>{t("goalStatement")}</Label><Textarea value={form.goalStatement} onChange={(e) => setForm({ ...form, goalStatement: e.target.value })} placeholder={t("goalStatementPlaceholder")} rows={2} /></div>
              </div>
              <div className="flex gap-2"><Button type="submit">{editingId ? common("update") : common("create")}</Button><Button type="button" variant="outline" onClick={resetForm}>{common("cancel")}</Button></div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {goals.length === 0 ? (
          <Card><CardContent className="py-12 text-center">
            <Target className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">{t("noGoals")}</h3>
            <p className="text-muted-foreground mb-4">{t("noGoalsDesc")}</p>
            <Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-2" /> {t("addFirstGoal")}</Button>
          </CardContent></Card>
        ) : goals.map((goal) => {
          const daysUntil = differenceInDays(new Date(goal.targetDate), new Date());
          return (
            <Card key={goal.id} className="hover:shadow-md transition-shadow">
              <CardContent className="py-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Link href={`/settings/goals/${goal.id}`} className="text-lg font-semibold hover:text-primary">{goal.name}</Link>
                      <Badge variant={goal.priority === "A" ? "destructive" : goal.priority === "B" ? "default" : "secondary"}>{t("priorityBadge", { priority: goal.priority })}</Badge>
                      <Badge variant={goal.status === "active" ? "success" : "secondary"}>{statusLabels[goal.status] || goal.status}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Route className="h-3 w-3" /> {formatDistance(goal.distanceMeters)}</span>
                      {goal.elevationGainMeters ? <span className="flex items-center gap-1"><Mountain className="h-3 w-3" /> {formatDistance(goal.elevationGainMeters)}</span> : null}
                      <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {format(new Date(goal.targetDate), "MMM d, yyyy")}</span>
                      <span className={daysUntil < 30 ? "text-destructive font-medium" : ""}>{daysUntil > 0 ? common("daysLeft", { days: daysUntil }) : common("pastDue")}</span>
                    </div>
                    {goal.goalStatement && <p className="text-sm text-muted-foreground italic mt-1">&ldquo;{goal.goalStatement}&rdquo;</p>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => startEdit(goal)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteGoal(goal.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
