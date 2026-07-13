"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, CalendarDays, Clock, Check, Key, ArrowRight, AlertTriangle, Trash2 } from "lucide-react";

const DATA_TYPES = [
  { key: "trainingLogs", label: "Training Logs", description: "Activities, laps, splits, and all training data" },
  { key: "raceGoals", label: "Race Goals", description: "Target races, events, and goal times" },
  { key: "trainingFacilities", label: "Training Facilities", description: "Saved locations, routes, and facilities" },
  { key: "bodyMetrics", label: "Body Metrics", description: "Weight, resting heart rate, and body measurements" },
  { key: "availability", label: "Availability", description: "Weekly training time slots" },
  { key: "weeklyAssessments", label: "Weekly Assessments", description: "CTL, ATL, TSB and readiness scores" },
  { key: "weeklyPlans", label: "Weekly Plans", description: "AI-generated weekly training plans" },
  { key: "fatigueAlerts", label: "Fatigue Alerts", description: "Overtraining and fatigue notifications" },
] as const;

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [reviewDay, setReviewDay] = useState(0);
  const [reviewTime, setReviewTime] = useState("18:00");
  const [scheduleSaved, setScheduleSaved] = useState(false);

  // Data wipe state
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [wipeConfirm, setWipeConfirm] = useState(false);
  const [wiping, setWiping] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
  }, [status, router]);

  useEffect(() => {
    fetch("/api/settings/review-schedule")
      .then((r) => r.json())
      .then((s) => { setReviewDay(s.reviewDayOfWeek ?? 0); setReviewTime(s.reviewTime ?? "18:00"); });
  }, []);

  if (status === "loading" || !session) return <div className="container mx-auto px-4 py-8">Loading...</div>;

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
      setMessage({ type: "success", text: `Deleted: ${summary.join(", ")}. Your account is still active.` });
    } else {
      setMessage({ type: "error", text: "Failed to wipe data. Please try again." });
    }
    setWiping(false);
    setWipeConfirm(false);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <h1 className="text-3xl font-bold mb-2">Settings</h1>
      <p className="text-muted-foreground mb-8">Manage your profile and integrations</p>

      {message && (
        <div className={`p-4 rounded-md mb-6 text-sm ${message.type === "success" ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-destructive/10 text-destructive"}`}>
          {message.text}
        </div>
      )}

      {/* Profile */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User className="h-5 w-5" /> Profile</CardTitle>
          <CardDescription>Your account details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{session.user?.name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span className="font-medium">{session.user?.email}</span></div>
          </div>
        </CardContent>
      </Card>

      {/* Review Schedule */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Weekly Review Schedule</CardTitle>
          <CardDescription>When the AI analyzes your training and generates next week's plan</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Day of Week</Label>
              <Select value={String(reviewDay)} onValueChange={(v) => setReviewDay(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
                    <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Time</Label>
              <Input type="time" value={reviewTime} onChange={(e) => setReviewTime(e.target.value)} />
            </div>
          </div>
          <Button
            size="sm"
            className="mt-4"
            onClick={async () => {
              await fetch("/api/settings/review-schedule", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reviewDayOfWeek: reviewDay, reviewTime: reviewTime }),
              });
              setScheduleSaved(true);
              setTimeout(() => setScheduleSaved(false), 2000);
            }}
          >
            {scheduleSaved ? <><Check className="h-3 w-3 mr-1" /> Saved</> : <><Clock className="h-3 w-3 mr-1" /> Save Schedule</>}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            The review runs on your chosen day at the specified time. It analyzes the last 4 weeks of training and generates next week's plan.
          </p>
        </CardContent>
      </Card>

      {/* API Credentials link */}
      <Link href="/settings/credentials" className="block mb-6">
        <Card className="hover:shadow-md transition-shadow cursor-pointer border-primary/20">
          <CardContent className="py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Key className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium">API Credentials</p>
                <p className="text-sm text-muted-foreground">Configure API keys and public URL</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>

      {/* Danger Zone */}
      <Card className="mt-6 border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" /> Danger Zone
          </CardTitle>
          <CardDescription>
            Permanently delete selected data types. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Choose the types of data you want to delete, then confirm. Your account will remain active.
          </p>

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
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAll}>
                  Deselect All
                </Button>
              </div>

              <Button
                variant="destructive"
                disabled={selectedTypes.size === 0}
                onClick={() => setWipeConfirm(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Wipe Selected Data ({selectedTypes.size})
              </Button>
            </>
          ) : (
            <div className="space-y-4 p-4 rounded-md bg-destructive/10 border border-destructive/30">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-destructive">Are you absolutely sure?</p>
                  <p className="text-xs text-muted-foreground mt-1">This action is irreversible. The following data will be permanently deleted:</p>
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
                  {wiping ? "Deleting..." : `Yes, Delete Selected (${selectedTypes.size})`}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={wiping}
                  onClick={() => setWipeConfirm(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
