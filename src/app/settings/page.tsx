"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, CalendarDays, Clock, Check } from "lucide-react";

export default function SettingsGeneralPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [reviewDay, setReviewDay] = useState(0);
  const [reviewTime, setReviewTime] = useState("18:00");
  const [scheduleSaved, setScheduleSaved] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
  }, [status, router]);

  useEffect(() => {
    fetch("/api/settings/review-schedule")
      .then((r) => r.json())
      .then((s) => { setReviewDay(s.reviewDayOfWeek ?? 0); setReviewTime(s.reviewTime ?? "18:00"); });
  }, []);

  if (status === "loading" || !session) return <div className="py-8">Loading...</div>;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">General</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your profile and weekly review preferences.
        </p>
      </div>

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
    </div>
  );
}
