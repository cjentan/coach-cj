import { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://coach.example.com";

const routes = [
  "/",
  "/dashboard",
  "/activities",
  "/goals",
  "/settings",
  "/settings/goals",
  "/settings/body-metrics",
  "/settings/analysis",
  "/settings/credentials",
  "/settings/integrations",
  "/settings/backup-restore",
  "/settings/danger-zone",
  "/heatmap",
  "/duplicates",
  "/ingestion",
  "/onboarding",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.flatMap((route) =>
    routing.locales.map((locale) => ({
      url: `${baseUrl}/${locale}${route === "/" ? "" : route}`,
      lastModified: new Date(),
      alternates: {
        languages: Object.fromEntries(
          routing.locales.map((l) => [l, `${baseUrl}/${l}${route === "/" ? "" : route}`])
        ),
      },
    }))
  );
}
