"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Users, Key, Copy, Check, Shield, ShieldOff, Activity,
  Target, Dumbbell, Scale, AlertTriangle, Calendar, Loader2,
  Watch, Radio, UserCheck, Mail, Settings2, Send,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { format } from "date-fns";

interface UserSummary {
  id: string; email: string; name: string; role: string; createdAt: string;
  trainingLogs: number; raceGoals: number; facilities: number;
  bodyMetrics: number; fatigueAlerts: number;
  latestWeight: number | null; latestWeightDate: string | null;
  lastActivity: string | null; lastActivityName: string | null;
  hasGarmin: boolean; hasCoros: boolean;
}

interface AdminData {
  summary: {
    totalUsers: number;
    totalActivities: number;
    garminUsers: number;
    corosUsers: number;
  };
  users: UserSummary[];
}

interface EmailSettings {
  resend_api_key: string;
  email_from: string;
  reset_link_expiry_hours: string;
}

interface ResetLinkResult {
  resetUrl: string;
  email: { sent: boolean; error?: string };
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <Card className="flex-1 min-w-0">
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-3">
          <div className="text-muted-foreground shrink-0">{icon}</div>
          <div className="min-w-0">
            <p className="text-2xl font-bold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground truncate">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // ── Tab state ──
  const [tab, setTab] = useState("users");

  // ── Users state ──
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetLinks, setResetLinks] = useState<Record<string, ResetLinkResult>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  // ── Email settings state ──
  const [emailSettings, setEmailSettings] = useState<EmailSettings>({
    resend_api_key: "", email_from: "", reset_link_expiry_hours: "4",
  });
  const [emailLoading, setEmailLoading] = useState(true);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailError, setEmailError] = useState("");
  // Test email
  const [testEmail, setTestEmail] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.status === 403) { router.push("/dashboard"); return; }
      if (!res.ok) throw new Error("Failed to fetch");
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const fetchEmailSettings = async () => {
    try {
      const res = await fetch("/api/admin/email-settings");
      if (!res.ok) return;
      const data = await res.json();
      setEmailSettings((prev) => ({
        ...prev,
        resend_api_key: data.resend_api_key || "",
        email_from: data.email_from || "",
        reset_link_expiry_hours: data.reset_link_expiry_hours || "4",
      }));
    } catch { /* ignore */ }
    setEmailLoading(false);
  };

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
    else if (status === "authenticated") {
      fetchUsers();
      fetchEmailSettings();
    }
  }, [status, router]);

  async function generateResetLink(userId: string) {
    setGenerating(userId);
    setResetLinks((prev) => ({ ...prev, [userId]: { resetUrl: "", email: { sent: false } } }));
    try {
      const res = await fetch("/api/admin/reset-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      setResetLinks((prev) => ({ ...prev, [userId]: { resetUrl: data.resetUrl, email: data.email } }));
    } catch {
      setResetLinks((prev) => ({ ...prev, [userId]: { resetUrl: "Error generating link", email: { sent: false } } }));
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

  async function saveEmailSettings() {
    setEmailSaving(true);
    setEmailError("");
    setEmailSaved(false);
    try {
      const res = await fetch("/api/admin/email-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emailSettings),
      });
      if (!res.ok) {
        const d = await res.json();
        setEmailError(d.error || "Failed to save");
        return;
      }
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 3000);
    } catch {
      setEmailError("Network error");
    } finally {
      setEmailSaving(false);
    }
  }

  async function sendTestEmail() {
    if (!testEmail) return;
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/email-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testEmail }),
      });
      const d = await res.json();
      setTestResult({
        ok: res.ok,
        message: res.ok ? "Test email sent successfully!" : d.error || "Failed to send",
      });
    } catch {
      setTestResult({ ok: false, message: "Network error" });
    } finally {
      setTestSending(false);
    }
  }

  if (status === "loading") return <div className="container mx-auto px-4 py-8">Loading...</div>;

  const summary = data?.summary;
  const users = data?.users ?? [];

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Settings2 className="h-7 w-7" /> Admin</h1>
          <p className="text-muted-foreground mt-1">Manage users, integrations, and system settings</p>
        </div>
      </div>

      {error && (
        <div className="p-4 mb-6 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" /> Users
          </TabsTrigger>
          <TabsTrigger value="email" className="gap-2">
            <Mail className="h-4 w-4" /> Email Settings
          </TabsTrigger>
        </TabsList>

        {/* ── Users Tab ── */}
        <TabsContent value="users">
          {/* Summary strip */}
          <div className="flex flex-wrap gap-3 mb-6">
            <StatCard icon={<Users className="h-5 w-5" />} label="Total Users" value={summary?.totalUsers ?? 0} />
            <StatCard icon={<Activity className="h-5 w-5" />} label="Total Activities" value={summary?.totalActivities ?? 0} />
            <StatCard icon={<Radio className="h-5 w-5" />} label="Garmin Users" value={summary?.garminUsers ?? 0} />
            <StatCard icon={<Watch className="h-5 w-5" />} label="COROS Users" value={summary?.corosUsers ?? 0} />
          </div>

          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-4">
              {users.map((user) => (
                <Card key={user.id}>
                  <CardContent className="py-4">
                    <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                      {/* User info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-semibold truncate">{user.name}</span>
                          {user.role === "admin" ? (
                            <Badge variant="default"><Shield className="h-3 w-3 mr-1" /> Admin</Badge>
                          ) : (
                            <Badge variant="outline"><ShieldOff className="h-3 w-3 mr-1" /> User</Badge>
                          )}
                          {user.hasGarmin && (
                            <Badge variant="secondary"><Radio className="h-3 w-3 mr-1" /> Garmin</Badge>
                          )}
                          {user.hasCoros && (
                            <Badge variant="secondary"><Watch className="h-3 w-3 mr-1" /> COROS</Badge>
                          )}
                          {!user.hasGarmin && !user.hasCoros && (
                            <Badge variant="outline" className="text-muted-foreground">No integration</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <UserCheck className="h-3 w-3 inline mr-0.5" />
                          Joined {format(new Date(user.createdAt), "MMM d, yyyy")}
                        </p>
                      </div>

                      {/* Stats */}
                      <div className="flex flex-wrap gap-3 text-xs">
                        <Stat icon={<Activity className="h-3 w-3" />} label="Activities" value={user.trainingLogs} />
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
                        ) : resetLinks[user.id]?.resetUrl ? (
                          <Button variant="outline" size="sm" onClick={() => copyLink(resetLinks[user.id].resetUrl, user.id)}>
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
                    {resetLinks[user.id]?.resetUrl && (
                      <div className="mt-2 space-y-1">
                        <div className="p-2 rounded bg-muted text-xs font-mono break-all">
                          {resetLinks[user.id].resetUrl}
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          {resetLinks[user.id].email.sent ? (
                            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                              <Check className="h-3 w-3" /> Email sent to {user.email}
                            </span>
                          ) : resetLinks[user.id].email.error ? (
                            <span className="flex items-center gap-1 text-destructive" title={resetLinks[user.id].email.error}>
                              <AlertTriangle className="h-3 w-3" /> Failed to email — {resetLinks[user.id].email.error}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">No email sent (Resend not configured)</span>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Email Settings Tab ── */}
        <TabsContent value="email">
          {emailLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="max-w-2xl space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" /> Resend Configuration</CardTitle>
                  <CardDescription>
                    Configure your Resend API key for password reset emails and system notifications.
                    Get your API key from the{" "}
                    <a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Resend dashboard</a>.
                    Make sure your domain is verified and you&apos;ve created an API key with sending permissions.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="resend_api_key">Resend API Key</Label>
                      <Input
                        id="resend_api_key"
                        type="password"
                        placeholder="re_..."
                        value={emailSettings.resend_api_key}
                        onChange={(e) => setEmailSettings((p) => ({ ...p, resend_api_key: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email_from">From Address</Label>
                      <Input
                        id="email_from"
                        type="email"
                        placeholder="noreply@yourdomain.com"
                        value={emailSettings.email_from}
                        onChange={(e) => setEmailSettings((p) => ({ ...p, email_from: e.target.value }))}
                      />
                      <p className="text-xs text-muted-foreground">
                        Must be a verified sender in your Resend account.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reset_link_expiry">Reset Link Expiry (hours)</Label>
                      <Input
                        id="reset_link_expiry"
                        type="number"
                        min={1}
                        max={168}
                        placeholder="4"
                        value={emailSettings.reset_link_expiry_hours}
                        onChange={(e) => setEmailSettings((p) => ({ ...p, reset_link_expiry_hours: e.target.value }))}
                      />
                      <p className="text-xs text-muted-foreground">
                        How long password reset links remain valid (1&ndash;168 hours).
                      </p>
                    </div>

                    {emailError && (
                      <div className="flex items-center gap-2 text-sm text-destructive">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>{emailError}</span>
                      </div>
                    )}

                    {emailSaved && (
                      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                        <Check className="h-4 w-4 shrink-0" />
                        <span>Settings saved.</span>
                      </div>
                    )}

                    <Button onClick={saveEmailSettings} disabled={emailSaving}>
                      {emailSaving ? "Saving..." : "Save Settings"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Test email card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Send className="h-5 w-5" /> Send Test Email</CardTitle>
                  <CardDescription>
                    Send a test email to verify your Resend configuration is working.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-3">
                    <div className="flex-1 space-y-2">
                      <Label htmlFor="test_email">Recipient Email</Label>
                      <Input
                        id="test_email"
                        type="email"
                        placeholder="you@example.com"
                        value={testEmail}
                        onChange={(e) => { setTestEmail(e.target.value); setTestResult(null); }}
                      />
                    </div>
                    <Button
                      onClick={sendTestEmail}
                      disabled={testSending || !testEmail}
                    >
                      {testSending ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Sending</> : "Send Test"}
                    </Button>
                  </div>

                  {testResult && (
                    <div className={`flex items-center gap-2 mt-3 text-sm ${testResult.ok ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                      {testResult.ok ? <Check className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
                      <span className="whitespace-pre-wrap">{testResult.message}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
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
