import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/routing";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Activity, BarChart3, Target, Heart, CalendarDays, TrendingUp } from "lucide-react";

export default async function Home() {
  const session = await auth();

  // Authenticated users go straight to dashboard
  if (session?.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { onboardingCompleted: true },
    });
    const needsOnboarding = user ? !user.onboardingCompleted : false;
    redirect(needsOnboarding ? "/onboarding" : "/dashboard");
  }

  const t = await getTranslations("home");

  const features = [
    { icon: <Activity className="h-6 w-6" />, key: "dataImport" },
    { icon: <Target className="h-6 w-6" />, key: "raceGoals" },
    { icon: <CalendarDays className="h-6 w-6" />, key: "weeklyPlans" },
    { icon: <Heart className="h-6 w-6" />, key: "fatigueDetection" },
    { icon: <BarChart3 className="h-6 w-6" />, key: "readinessScore" },
    { icon: <TrendingUp className="h-6 w-6" />, key: "trajectoryTracking" },
  ];

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="px-4 py-20 md:py-32 max-w-4xl mx-auto text-center">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
          {t("heroTitle")}<br />
          <span className="text-primary">{t("heroTitleAccent")}</span>
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          {t("heroDescription")}
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/auth/signup">
            <Button size="lg" className="text-lg px-8">Get Started Free</Button>
          </Link>
          <Link href="/auth/signin">
            <Button size="lg" variant="outline" className="text-lg px-8">Sign In</Button>
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="px-4 py-16 bg-muted/50">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((f) => (
            <FeatureCard
              key={f.key}
              icon={f.icon}
              title={t(`features.${f.key}.title`)}
              description={t(`features.${f.key}.description`)}
            />
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-16 max-w-2xl mx-auto text-center">
        <h2 className="text-3xl font-bold mb-4">{t("ctaTitle")}</h2>
        <p className="text-muted-foreground mb-8">{t("ctaDescription")}</p>
        <Link href="/auth/signup">
          <Button size="lg" className="text-lg px-8">{t("ctaButton")}</Button>
        </Link>
      </section>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-6 hover:shadow-md transition-shadow">
      <div className="text-primary mb-4">{icon}</div>
      <h3 className="font-semibold text-lg mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
