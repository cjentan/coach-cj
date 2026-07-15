import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Activity, BarChart3, Target, Heart, CalendarDays, TrendingUp } from "lucide-react";

export default async function Home() {
  const session = await auth();

  // Check if the user has completed onboarding
  let needsOnboarding = false;
  if (session?.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { onboardingCompleted: true },
    });
    needsOnboarding = user ? !user.onboardingCompleted : false;
  }

  const dashboardHref = needsOnboarding ? "/onboarding" : "/dashboard";

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="px-4 py-20 md:py-32 max-w-4xl mx-auto text-center">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
          Train Smarter.<br />
          <span className="text-primary">Race Stronger.</span>
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          Coach imports your training data from GPX, FIT, or CSV files, builds personalized
          weekly plans for your goal races, detects fatigue before you get injured, and
          keeps you on track every single week.
        </p>
        {session?.user ? (
          <Link href={dashboardHref}>
            <Button size="lg" className="text-lg px-8">{needsOnboarding ? "Complete Setup" : "Go to Dashboard"}</Button>
          </Link>
        ) : (
          <div className="flex gap-4 justify-center">
            <Link href="/auth/signup">
              <Button size="lg" className="text-lg px-8">Get Started Free</Button>
            </Link>
            <Link href="/auth/signin">
              <Button size="lg" variant="outline" className="text-lg px-8">Sign In</Button>
            </Link>
          </div>
        )}
      </section>

      {/* Features */}
      <section className="px-4 py-16 bg-muted/50">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          <FeatureCard
            icon={<Activity className="h-6 w-6" />}
            title="Data Import"
            description="Upload GPX, TCX, FIT, or CSV files from your devices — Garmin, Wahoo, COROS, and more."
          />
          <FeatureCard
            icon={<Target className="h-6 w-6" />}
            title="Race Goals"
            description="Set your target races — 100km ultra, marathon, triathlon — with distance, elevation, and date."
          />
          <FeatureCard
            icon={<CalendarDays className="h-6 w-6" />}
            title="Weekly Plans"
            description="Every Sunday, get a personalized training plan for the week ahead, built around your schedule."
          />
          <FeatureCard
            icon={<Heart className="h-6 w-6" />}
            title="Fatigue Detection"
            description="We monitor 8 fatigue signals — TSB, HR drift, monotony, strain — and warn you before you break down."
          />
          <FeatureCard
            icon={<BarChart3 className="h-6 w-6" />}
            title="Readiness Score"
            description="A single 0-100 score combining fitness, fatigue, volume adherence, and consistency."
          />
          <FeatureCard
            icon={<TrendingUp className="h-6 w-6" />}
            title="Trajectory Tracking"
            description="See if your training ramp is on track to hit your goal — and get adjustments if it isn't."
          />
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-16 max-w-2xl mx-auto text-center">
        <h2 className="text-3xl font-bold mb-4">Ready to take your training seriously?</h2>
        <p className="text-muted-foreground mb-8">
          No more guessing. Let data drive your training decisions.
        </p>
        {!session?.user && (
          <Link href="/auth/signup">
            <Button size="lg" className="text-lg px-8">Start Your Training Journey</Button>
          </Link>
        )}
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
