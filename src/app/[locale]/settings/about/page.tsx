import fs from "fs";
import path from "path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Info } from "lucide-react";
import { APP_NAME, APP_VERSION } from "@/lib/app-info";

// Read the repo-root changelog once per request so it stays in sync with
// CHANGELOG.md (single source of truth) without needing an API route.
const changelogPath = path.join(process.cwd(), "CHANGELOG.md");
const changelog = fs.readFileSync(changelogPath, "utf-8");

export default async function SettingsAboutPage() {
  const t = await getTranslations("settings.about");

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("description")}</p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" /> {APP_NAME}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("versionLabel")}</span>
            <Badge variant="secondary">{APP_VERSION}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-3">{t("appStatement")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("changelogTitle")}</CardTitle>
          <CardDescription>{t("changelogDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{changelog}</ReactMarkdown>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
