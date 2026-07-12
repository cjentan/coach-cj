"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, CalendarDays, Clock, Check, Key, ArrowRight, AlertTriangle, Trash2 } from "lucide-react";

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [reviewDay, setReviewDay] = useState(0);
  const [reviewTime, setReviewTime] = useState("18:00");
  const [scheduleSaved, setScheduleSaved] = useState(false);
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
            Permanently delete all your training data. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            This will remove all your training logs, goals, facilities, body metrics,
            availability schedules, assessments, weekly plans, and fatigue alerts.
            <strong>Your account will remain active.</strong>
          </p>

          {!wipeConfirm ? (
            <Button
              variant="destructive"
              onClick={() => setWipeConfirm(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Wipe All Data
            </Button>
          ) : (
            <div className="flex items-center gap-3 p-3 rounded-md bg-destructive/10 border border-destructive/30">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-destructive">Are you absolutely sure?</p>
                <p className="text-xs text-muted-foreground">This action is irreversible. All your training history will be lost.</p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                disabled={wiping}
                onClick={async () => {
                  setWiping(true);
                  const res = await fetch("/api/settings/wipe-data", { method: "DELETE" });
                  if (res.ok) {
                    setMessage({ type: "success", text: "All data has been wiped. Your account is still active." });
                  } else {
                    setMessage({ type: "error", text: "Failed to wipe data. Please try again." });
                  }
                  setWiping(false);
                  setWipeConfirm(false);
                }}
              >
                {wiping ? "Wiping..." : "Yes, Delete Everything"}
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
