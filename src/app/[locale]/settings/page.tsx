"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useTheme } from "next-themes";
import { User, Sun, Moon, Monitor, AlertCircle, Check, MapPin, KeyRound, Languages } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";

export default function SettingsGeneralPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Language state
  const currentLocale = useLocale();
  const t = useTranslations("settings.general");
  const common = useTranslations("common");

  async function handleLocaleChange(newLocale: string) {
    await fetch("/api/settings/locale", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: newLocale }),
    });
    // Set cookie for next-intl
    document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=31536000`;
    // Reload to apply
    window.location.href = `/${newLocale}/settings`;
  }

  // Training context state
  const [trainingContext, setTrainingContext] = useState("");
  const [trainingContextLoading, setTrainingContextLoading] = useState(true);
  const [trainingContextSaving, setTrainingContextSaving] = useState(false);
  const [trainingContextSaved, setTrainingContextSaved] = useState(false);
  const [trainingContextError, setTrainingContextError] = useState("");

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
  }, [status, router]);

  // Fetch training context on mount
  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/settings/training-context")
      .then((r) => r.json())
      .then((data) => {
        setTrainingContext(data.trainingContext || "");
        setTrainingContextLoading(false);
      })
      .catch(() => setTrainingContextLoading(false));
  }, [status]);

  async function handleSaveTrainingContext() {
    setTrainingContextSaving(true);
    setTrainingContextError("");
    setTrainingContextSaved(false);
    try {
      const res = await fetch("/api/settings/training-context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trainingContext }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setTrainingContextSaved(true);
      setTimeout(() => setTrainingContextSaved(false), 3000);
    } catch {
      setTrainingContextError(t("contextSaveFailed"));
    }
    setTrainingContextSaving(false);
  }

  if (status === "loading" || !session) return <div className="py-8">{common("loading")}</div>;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("cardProfileDesc")}
        </p>
      </div>

      {/* Profile */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User className="h-5 w-5" /> {t("cardProfileTitle")}</CardTitle>
          <CardDescription>{t("cardProfileAccountDetails")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">{t("cardName")}</span><span className="font-medium">{session.user?.name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{t("cardEmail")}</span><span className="font-medium">{session.user?.email}</span></div>
            <div className="flex justify-between pt-2 border-t border-border/50">
              <span className="text-muted-foreground">{t("cardPassword")}</span>
              <Dialog>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1.5"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    {t("changePassword")}
                  </button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>{t("changePassword")}</DialogTitle>
                    <DialogDescription>{t("changePasswordDesc")}</DialogDescription>
                  </DialogHeader>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setPasswordError("");
                      setPasswordSuccess(false);

                      if (newPassword !== confirmPassword) {
                        setPasswordError(t("passwordMismatch"));
                        return;
                      }

                      if (newPassword.length < 8) {
                        setPasswordError(t("passwordTooShort"));
                        return;
                      }

                      setPasswordLoading(true);
                      try {
                        const res = await fetch("/api/settings/change-password", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ currentPassword, newPassword }),
                        });

                        const data = await res.json();

                        if (!res.ok) {
                          setPasswordError(data.error || t("changePasswordFailed"));
                          return;
                        }

                        setPasswordSuccess(true);
                        setCurrentPassword("");
                        setNewPassword("");
                        setConfirmPassword("");
                        setTimeout(() => setPasswordSuccess(false), 3000);
                      } catch {
                        setPasswordError(t("networkError"));
                      } finally {
                        setPasswordLoading(false);
                      }
                    }}
                  >
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="current-password">{t("currentPassword")}</Label>
                        <Input
                          id="current-password"
                          type="password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-password">{t("newPassword")}</Label>
                        <Input
                          id="new-password"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          required
                          minLength={8}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="confirm-password">{t("confirmNewPassword")}</Label>
                        <Input
                          id="confirm-password"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                          minLength={8}
                        />
                      </div>

                      {passwordError && (
                        <div className="flex items-center gap-2 text-sm text-destructive">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          <span>{passwordError}</span>
                        </div>
                      )}

                      {passwordSuccess && (
                        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                          <Check className="h-4 w-4 shrink-0" />
                          <span>{t("passwordChanged")}</span>
                        </div>
                      )}

                      <div className="flex justify-end gap-3">
                        <DialogClose asChild>
                          <Button type="button" variant="outline" disabled={passwordLoading}>
                            {common("cancel")}
                          </Button>
                        </DialogClose>
                        <Button type="submit" disabled={passwordLoading}>
                          {passwordLoading ? t("changing") : t("changePassword")}
                        </Button>
                      </div>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Where and When I Can Train */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5" /> {t("trainingContextTitle")}</CardTitle>
          <CardDescription>{t("trainingContextDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {trainingContextLoading ? (
            <p className="text-sm text-muted-foreground">{common("loading")}</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="training-context">{t("trainingContextLabel")}</Label>
                <Textarea
                  id="training-context"
                  rows={6}
                  placeholder={t("trainingContextPlaceholder")}
                  value={trainingContext}
                  onChange={(e) => setTrainingContext(e.target.value)}
                />
              </div>

              {trainingContextError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{trainingContextError}</span>
                </div>
              )}

              {trainingContextSaved && (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <Check className="h-4 w-4 shrink-0" />
                  <span>{t("contextSaved")}</span>
                </div>
              )}

              <Button onClick={handleSaveTrainingContext} disabled={trainingContextSaving}>
                {trainingContextSaving ? common("saving") : common("save")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Language */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Languages className="h-5 w-5" /> Language</CardTitle>
          <CardDescription>Choose your preferred language</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 flex-wrap">
            {[
              { value: "en", label: "English" },
              { value: "zh-CN", label: "简体中文" },
              { value: "zh-TW", label: "繁體中文" },
            ].map(({ value, label }) => (
              <button
                key={value}
                onClick={() => handleLocaleChange(value)}
                className={`flex-1 min-w-[120px] rounded-lg border-2 p-4 text-center transition-all ${
                  currentLocale === value
                    ? "border-primary bg-primary/5 text-primary font-medium"
                    : "border-muted hover:border-muted-foreground/30 text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">{mounted && (theme === "dark" ? <Moon className="h-5 w-5" /> : theme === "light" ? <Sun className="h-5 w-5" /> : <Monitor className="h-5 w-5" />)} {t("appearanceTitle")}</CardTitle>
          <CardDescription>{t("appearanceDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {[
              { value: "light", label: t("light"), icon: Sun },
              { value: "dark", label: t("dark"), icon: Moon },
              { value: "system", label: t("system"), icon: Monitor },
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={`flex flex-1 flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all ${
                  mounted && theme === value
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/30"
                }`}
              >
                <Icon className={`h-6 w-6 ${mounted && theme === value ? "text-primary" : "text-muted-foreground"}`} />
                <span className={`text-sm font-medium ${mounted && theme === value ? "text-primary" : "text-muted-foreground"}`}>{label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
