"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users, Key, Copy, Check, Shield, ShieldOff, Activity,
  Target, Dumbbell, Scale, AlertTriangle, Calendar, Loader2,
} from "lucide-react";
import { formatDistance } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";

interface UserSummary {
  id: string; email: string; name: string; role: string; createdAt: string;
  trainingLogs: number; raceGoals: number; facilities: number;
  bodyMetrics: number; fatigueAlerts: number;
  latestWeight: number | null; latestWeightDate: string | null;
  lastActivity: string | null; lastActivityName: string | null;
}

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetLinks, setResetLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.status === 403) { router.push("/dashboard"); return; }
      if (!res.ok) throw new Error("Failed to fetch");
      setUsers(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
    else if (status === "authenticated") fetchUsers();
  }, [status, router]);

  async function generateResetLink(userId: string) {
    setGenerating(userId);
    setResetLinks((prev) => ({ ...prev, [userId]: "" }));
    try {
      const res = await fetch("/api/admin/reset-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      setResetLinks((prev) => ({ ...prev, [userId]: data.resetUrl }));
    } catch {
      setResetLinks((prev) => ({ ...prev, [userId]: "Error generating link" }));
    }
    setGenerating(null);
  }

  async function toggleRole(userId: string, currentRole: string) {
    const newRole = currentRole === "admin" ? "user" : "admin";
    setToggling(userId);
    try {
      await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: newRole }),
      });
      fetchUsers();
    } catch { /* ignore */ }
    setToggling(null);
  }

  function copyLink(link: string, userId: string) {
    navigator.clipboard.writeText(link);
    setCopied(userId);
    setTimeout(() => setCopied(null), 2000);
  }

  if (loading) return <div className="container mx-auto px-4 py-8">Loading...</div>;

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Users className="h-7 w-7" /> Admin</h1>
          <p className="text-muted-foreground mt-1">{users.length} user{users.length !== 1 ? "s" : ""} registered</p>
        </div>
      </div>

      {error && (
        <div className="p-4 mb-6 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
      )}

      <div className="space-y-4">
        {users.map((user) => (
          <Card key={user.id}>
            <CardContent className="py-4">
              <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                {/* User info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold truncate">{user.name}</span>
                    {user.role === "admin" ? (
                      <Badge variant="default"><Shield className="h-3 w-3 mr-1" /> Admin</Badge>
                    ) : (
                      <Badge variant="outline"><ShieldOff className="h-3 w-3 mr-1" /> User</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Joined {format(new Date(user.createdAt), "MMM d, yyyy")}</p>
                </div>

                {/* Stats */}
                <div className="flex flex-wrap gap-3 text-xs">
                  <Stat icon={<Activity className="h-3 w-3" />} label="Logs" value={user.trainingLogs} />
                  <Stat icon={<Target className="h-3 w-3" />} label="Goals" value={user.raceGoals} />
                  <Stat icon={<Dumbbell className="h-3 w-3" />} label="Facilities" value={user.facilities} />
                  <Stat icon={<Scale className="h-3 w-3" />} label="Metrics" value={user.bodyMetrics} />
                  <Stat icon={<AlertTriangle className="h-3 w-3" />} label="Alerts" value={user.fatigueAlerts} />
                  {user.latestWeight && (
                    <Stat icon={null} label="Weight" value={`${user.latestWeight} kg`} />
                  )}
                  {user.lastActivity && (
                    <Stat icon={<Calendar className="h-3 w-3" />} label="Last Activity"
                      value={formatDistanceToNow(new Date(user.lastActivity), { addSuffix: true })} />
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={toggling === user.id}
                    onClick={() => toggleRole(user.id, user.role)}
                    title={user.role === "admin" ? "Demote to user" : "Promote to admin"}
                  >
                    {user.role === "admin"
                      ? <ShieldOff className="h-4 w-4" />
                      : <Shield className="h-4 w-4" />}
                  </Button>
                  {generating === user.id ? (
                    <Button variant="outline" size="sm" disabled>
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Generating...
                    </Button>
                  ) : resetLinks[user.id] ? (
                    <Button variant="outline" size="sm" onClick={() => copyLink(resetLinks[user.id], user.id)}>
                      {copied === user.id ? (
                        <><Check className="h-3 w-3 mr-1" /> Copied</>
                      ) : (
                        <><Copy className="h-3 w-3 mr-1" /> Copy Link</>
                      )}
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => generateResetLink(user.id)}>
                      <Key className="h-3 w-3 mr-1" /> Reset PW
                    </Button>
                  )}
                </div>
              </div>

              {/* Reset link display */}
              {resetLinks[user.id] && (
                <div className="mt-2 p-2 rounded bg-muted text-xs font-mono break-all">
                  {resetLinks[user.id]}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-1 text-muted-foreground whitespace-nowrap">
      {icon}
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
