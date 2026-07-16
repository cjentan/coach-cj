"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Key, CheckCircle2 } from "lucide-react";

function ResetForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations("auth.resetPassword");
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError(t("errorMismatch"));
      return;
    }

    setLoading(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || t("errorGeneric"));
    } else {
      setSuccess(true);
      setTimeout(() => router.push("/auth/signin"), 3000);
    }
  }

  if (!token) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-3.5rem)] px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>{t("invalidLinkTitle")}</CardTitle>
            <CardDescription>{t("invalidLinkDesc")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-3.5rem)] px-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-6">
            <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
            <h2 className="text-xl font-semibold mb-2">{t("successTitle")}</h2>
            <p className="text-muted-foreground">{t("successDesc")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-3.5rem)] px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Key className="h-8 w-8 mx-auto text-primary mb-2" />
          <CardTitle>{t("setNewTitle")}</CardTitle>
          <CardDescription>{t("setNewDesc")}</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && <div className="p-3 text-sm rounded-md bg-destructive/10 text-destructive">{error}</div>}
            <div className="space-y-2">
              <Label>{t("newPasswordLabel")}</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("newPasswordLabel")} required minLength={8} />
            </div>
            <div className="space-y-2">
              <Label>{t("confirmPasswordLabel")}</Label>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={t("confirmPasswordLabel")} required minLength={8} />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t("resetting") : t("resetButton")}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  const t = useTranslations("common");
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[calc(100vh-3.5rem)]">{t("loading")}</div>}>
      <ResetForm />
    </Suspense>
  );
}
