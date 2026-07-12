"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistance } from "@/lib/utils";
import { format, differenceInDays } from "date-fns";
import { Target, Calendar, Mountain, Route, Clock, ArrowLeft } from "lucide-react";

interface RaceGoal {
  id: string; name: string; raceType: string; targetDate: string;
  distanceMeters: number; elevationGainMeters: number | null;
  targetTimeSeconds: number | null; priority: "A" | "B" | "C"; status: string; notes: string | null;
}

export default function GoalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [goal, setGoal] = useState<RaceGoal | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/goals/${id}`).then((r) => r.json()).then(setGoal).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="container mx-auto px-4 py-8">Loading...</div>;
  if (!goal) return <div className="container mx-auto px-4 py-8">Goal not found.</div>;

  const daysUntil = differenceInDays(new Date(goal.targetDate), new Date());
  const weeksUntil = Math.max(1, Math.ceil(daysUntil / 7));

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <Button variant="ghost" onClick={() => router.back()} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-2" /> Back
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <Badge variant={goal.priority === "A" ? "destructive" : goal.priority === "B" ? "default" : "secondary"}>
              {goal.priority}-Goal
            </Badge>
            <Badge variant={goal.status === "active" ? "success" : "secondary"}>{goal.status}</Badge>
          </div>
          <CardTitle className="text-2xl">{goal.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="py-4 text-center">
                <Route className="h-5 w-5 mx-auto text-primary mb-1" />
                <div className="text-xl font-bold">{formatDistance(goal.distanceMeters)}</div>
                <div className="text-xs text-muted-foreground">Distance</div>
              </CardContent>
            </Card>
            {goal.elevationGainMeters && (
              <Card>
                <CardContent className="py-4 text-center">
                  <Mountain className="h-5 w-5 mx-auto text-primary mb-1" />
                  <div className="text-xl font-bold">{formatDistance(goal.elevationGainMeters)}</div>
                  <div className="text-xs text-muted-foreground">Elevation Gain</div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="py-4 text-center">
                <Calendar className="h-5 w-5 mx-auto text-primary mb-1" />
                <div className="text-xl font-bold">{format(new Date(goal.targetDate), "MMM d, yyyy")}</div>
                <div className="text-xs text-muted-foreground">{daysUntil > 0 ? `${daysUntil} days (${weeksUntil} weeks)` : "Past due"}</div>
              </CardContent>
            </Card>
          </div>

          {goal.targetTimeSeconds && (
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Target Time:</span>
              <span className="font-medium">
                {Math.floor(goal.targetTimeSeconds / 3600)}h {Math.round((goal.targetTimeSeconds % 3600) / 60)}m
              </span>
            </div>
          )}

          <Card>
            <CardHeader><CardTitle className="text-lg">Training Plan Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recommended peak weekly volume</span>
                  <span className="font-medium">{formatDistance(goal.distanceMeters * 0.7)}</span>
                </div>
                {goal.elevationGainMeters && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Recommended peak weekly vert</span>
                    <span className="font-medium">{formatDistance(goal.elevationGainMeters * 0.5)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Weeks remaining</span>
                  <span className="font-medium">{weeksUntil}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Volume ramp rate</span>
                  <span className="font-medium">5-10% per week</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {goal.notes && (
            <div>
              <h3 className="font-semibold mb-2">Notes</h3>
              <p className="text-sm text-muted-foreground">{goal.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
