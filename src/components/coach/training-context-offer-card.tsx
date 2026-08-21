"use client";

import { useTranslations } from "next-intl";
import { ClipboardList, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TrainingContextOfferCardProps {
  onStart: () => void;
  onSkip: () => void;
}

export default function TrainingContextOfferCard({
  onStart,
  onSkip,
}: TrainingContextOfferCardProps) {
  const t = useTranslations("coach");

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <ClipboardList className="h-4 w-4 shrink-0 text-primary" />
        {t("contextOfferTitle")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{t("contextOfferDescription")}</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={onStart}>
          {t("contextOfferStart")}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onSkip}>
          <X className="mr-1 h-3 w-3" /> {t("contextOfferSkip")}
        </Button>
      </div>
    </div>
  );
}
