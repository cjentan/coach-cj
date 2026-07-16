"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "@/i18n/routing";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Activity, Lock, AlertCircle } from "lucide-react";

export default function SignInPage() {
  const router = useRouter();
  const t = useTranslations("auth.signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);
  const [forgotMsg, setForgotMsg] = useState("");

  useEffect(() => {
    fetch("/api/auth/email-status")
      .then((r) => r.json())
      .then((d) => setEmailConfigured(d.configured))
      .catch(() => setEmailConfigured(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError(t("errorInvalid"));
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  }

  function handleForgotClick() {
    if (!emailConfigured) {
      setForgotMsg(t("forgotNotEnabled"));
      setTimeout(() => setForgotMsg(""), 4000);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-3.5rem)] px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <Activity className="h-8 w-8 text-primary" />
          </div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 text-sm rounded-md bg-destructive/10 text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">{t("emailLabel")}</Label>
              <Input
                id="email"
                type="email"
                placeholder={t("emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t("passwordLabel")}</Label>
                {emailConfigured !== null && (
                  <button
                    type="button"
                    onClick={handleForgotClick}
                    className={`text-xs transition-colors ${
                      emailConfigured
                        ? "text-primary hover:underline cursor-pointer"
                        : "text-muted-foreground/50 cursor-not-allowed"
                    }`}
                  >
                    {t("forgotPassword")}
                  </button>
                )}
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {forgotMsg && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 p-2 rounded-md">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{forgotMsg}</span>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t("signingIn") : t("signInButton")}
            </Button>
            <p className="text-sm text-muted-foreground">
              {t("noAccount")}{" "}
              <Link href="/auth/signup" className="text-primary hover:underline">
                {t("signUpLink")}
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
