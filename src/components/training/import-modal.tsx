"use client";

import { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACTIVITY_TYPES, SUB_TYPE_OPTIONS } from "@/lib/constants";
import {
  Upload,
  FileType,
  Pencil,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";

interface FileResult {
  filename: string;
  status: string;
  error?: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  message: string;
  results?: FileResult[];
}

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: () => void;
}

export default function ImportModal({ open, onOpenChange, onImport }: ImportModalProps) {
  const t = useTranslations("ingestion");
  const trainingT = useTranslations("training");
  const common = useTranslations("common");
  const labelsT = useTranslations("labels");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Manual entry state ─────────────────────────────────────────────
  const [manualForm, setManualForm] = useState({
    name: "",
    type: "run",
    subType: "",
    date: new Date().toISOString().slice(0, 16),
    durationMinutes: "",
    durationSeconds: "",
    distance: "",
    elevation: "",
    avgHr: "",
    maxHr: "",
    calories: "",
    description: "",
  });
  const [manualResult, setManualResult] = useState<string | null>(null);
  const [manualSubmitting, setManualSubmitting] = useState(false);

  // ── File upload state ──────────────────────────────────────────────
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fileResults, setFileResults] = useState<FileResult[]>([]);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  // ── Reset form when dialog opens ───────────────────────────────────
  function resetForms() {
    setManualForm({
      name: "",
      type: "run",
      subType: "",
      date: new Date().toISOString().slice(0, 16),
      durationMinutes: "",
      durationSeconds: "",
      distance: "",
      elevation: "",
      avgHr: "",
      maxHr: "",
      calories: "",
      description: "",
    });
    setManualResult(null);
    setManualSubmitting(false);
    setFiles([]);
    setUploading(false);
    setFileResults([]);
    setUploadMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Manual Submit ──────────────────────────────────────────────────
  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    setManualResult(null);

    const durationSec =
      parseInt(manualForm.durationMinutes || "0") * 60 +
      parseInt(manualForm.durationSeconds || "0");
    if (durationSec <= 0) {
      setManualResult(t("manual.invalidDuration"));
      return;
    }

    setManualSubmitting(true);

    const body: Record<string, unknown> = {
      name: manualForm.name,
      type: manualForm.type,
      subType: manualForm.subType || null,
      startDate: new Date(manualForm.date).toISOString(),
      durationSeconds: durationSec,
      distanceMeters: manualForm.distance ? parseFloat(manualForm.distance) : null,
      elevationGainMeters: manualForm.elevation ? parseFloat(manualForm.elevation) : null,
      averageHr: manualForm.avgHr ? parseFloat(manualForm.avgHr) : null,
      maxHr: manualForm.maxHr ? parseFloat(manualForm.maxHr) : null,
      calories: manualForm.calories ? parseFloat(manualForm.calories) : null,
      description: manualForm.description || null,
    };

    try {
      const res = await fetch("/api/ingestion/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        onImport();
        onOpenChange(false);
      } else {
        const data = await res.json();
        setManualResult(data.error || t("manual.createFailed"));
      }
    } catch {
      setManualResult(t("manual.networkError"));
    }
    setManualSubmitting(false);
  }

  // ── File Upload ────────────────────────────────────────────────────
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  }

  async function handleFileUpload() {
    if (files.length === 0) return;
    setUploading(true);
    setFileResults([]);
    setUploadMessage(null);

    const form = new FormData();
    for (const file of files) {
      form.append("files", file);
    }

    try {
      const res = await fetch("/api/ingestion/gpx", {
        method: "POST",
        body: form,
      });
      const data: ImportResult = await res.json();
      setFileResults(data.results || []);
      setUploadMessage(data.message);

      if (data.imported > 0) {
        // Brief delay so the user can see the results
        setTimeout(() => {
          onImport();
          onOpenChange(false);
        }, 1500);
      }
    } catch {
      setUploadMessage(t("networkError"));
    }
    setUploading(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) resetForms();
        onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("modalTitle")}</DialogTitle>
          <DialogDescription>{t("modalDesc")}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="manual" className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual">
              <Pencil className="h-4 w-4 mr-2" /> {t("tabs.manual")}
            </TabsTrigger>
            <TabsTrigger value="upload">
              <Upload className="h-4 w-4 mr-2" /> {t("tabs.file")}
            </TabsTrigger>
          </TabsList>

          {/* ── Manual Entry Tab ─────────────────────────── */}
          <TabsContent value="manual" className="space-y-4 mt-4">
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{trainingT("activityName")}</Label>
                  <Input
                    value={manualForm.name}
                    onChange={(e) => setManualForm({ ...manualForm, name: e.target.value })}
                    placeholder={t("manual.namePlaceholder")}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>{trainingT("activityType")}</Label>
                  <Select
                    value={manualForm.type}
                    onValueChange={(v) => {
                      setManualForm({ ...manualForm, type: v, subType: "" });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTIVITY_TYPES.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <span className="flex items-center gap-2">
                            <opt.icon className="h-4 w-4" />{" "}
                            {labelsT("activityTypes." + opt.labelKey)}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {SUB_TYPE_OPTIONS[manualForm.type] &&
                  SUB_TYPE_OPTIONS[manualForm.type].length > 0 && (
                    <div className="space-y-2">
                      <Label>{trainingT("subType")}</Label>
                      <Select
                        value={manualForm.subType}
                        onValueChange={(v) => setManualForm({ ...manualForm, subType: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("manual.subTypeNone")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">{t("manual.subTypeNone")}</SelectItem>
                          {SUB_TYPE_OPTIONS[manualForm.type].map((st) => (
                            <SelectItem key={st.value} value={st.value}>
                              {labelsT("subTypes." + st.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                <div className="space-y-2">
                  <Label>{trainingT("date")}</Label>
                  <Input
                    type="datetime-local"
                    value={manualForm.date}
                    onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>{trainingT("duration")}</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder={t("manual.min")}
                      value={manualForm.durationMinutes}
                      onChange={(e) =>
                        setManualForm({ ...manualForm, durationMinutes: e.target.value })
                      }
                    />
                    <Input
                      type="number"
                      placeholder={t("manual.sec")}
                      value={manualForm.durationSeconds}
                      onChange={(e) =>
                        setManualForm({ ...manualForm, durationSeconds: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{trainingT("distance")}</Label>
                  <Input
                    type="number"
                    value={manualForm.distance}
                    onChange={(e) => setManualForm({ ...manualForm, distance: e.target.value })}
                    placeholder="12000"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{trainingT("elevation")}</Label>
                  <Input
                    type="number"
                    value={manualForm.elevation}
                    onChange={(e) => setManualForm({ ...manualForm, elevation: e.target.value })}
                    placeholder="450"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("manual.avgHrLabel")}</Label>
                  <Input
                    type="number"
                    value={manualForm.avgHr}
                    onChange={(e) => setManualForm({ ...manualForm, avgHr: e.target.value })}
                    placeholder="142"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("manual.maxHrLabel")}</Label>
                  <Input
                    type="number"
                    value={manualForm.maxHr}
                    onChange={(e) => setManualForm({ ...manualForm, maxHr: e.target.value })}
                    placeholder="172"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("manual.caloriesLabel")}</Label>
                  <Input
                    type="number"
                    value={manualForm.calories}
                    onChange={(e) => setManualForm({ ...manualForm, calories: e.target.value })}
                    placeholder="450"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>{trainingT("description")}</Label>
                  <Input
                    value={manualForm.description}
                    onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })}
                    placeholder={t("manual.notesPlaceholder")}
                  />
                </div>
              </div>

              {manualResult && (
                <div
                  className={`p-3 rounded-md text-sm ${
                    manualResult.includes("success") || manualResult.includes("created")
                      ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
                      : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {manualResult}
                </div>
              )}

              <Button type="submit" disabled={manualSubmitting}>
                {manualSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> {common("saving")}
                  </>
                ) : (
                  <>
                    <Pencil className="h-4 w-4 mr-2" /> {trainingT("save")}
                  </>
                )}
              </Button>
            </form>
          </TabsContent>

          {/* ── File Upload Tab ──────────────────────────── */}
          <TabsContent value="upload" className="space-y-4 mt-4">
            {!uploading && fileResults.length === 0 && (
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center hover:bg-muted/50 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileType className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="font-medium mb-1">{t("fileUpload.clickToUpload")}</p>
                <p className="text-sm text-muted-foreground">{t("fileUpload.multiFiles")}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".gpx,.tcx,.fit,.xml"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>
            )}

            {/* Selected files list (before upload) */}
            {files.length > 0 && !uploading && fileResults.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {t("fileUpload.filesSelected", { count: files.length })}
                </p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {files.map((f, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-sm p-1.5 rounded bg-muted/50"
                    >
                      <FileType className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1">{f.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {(f.size / 1024).toFixed(0)} KB
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-2">
                  <Button onClick={handleFileUpload}>
                    <Upload className="h-4 w-4 mr-2" />{" "}
                    {t("fileUpload.uploadFiles", { count: files.length })}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFiles([]);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  >
                    {common("cancel")}
                  </Button>
                </div>
              </div>
            )}

            {/* Uploading */}
            {uploading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-lg p-4">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("fileUpload.parsing")}
              </div>
            )}

            {/* Results */}
            {fileResults.length > 0 && (
              <div className="space-y-3">
                <div
                  className={`p-3 rounded-lg text-sm ${
                    uploadMessage?.includes("Imported")
                      ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
                      : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                  }`}
                >
                  {uploadMessage}
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {fileResults.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-sm p-2 rounded bg-muted/50"
                    >
                      {r.status === "imported" ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                      ) : r.status === "skipped" ? (
                        <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive shrink-0" />
                      )}
                      <span className="flex-1 truncate">{r.filename}</span>
                      <Badge
                        variant={
                          r.status === "imported"
                            ? "success"
                            : r.status === "skipped"
                              ? "warning"
                              : "destructive"
                        }
                      >
                        {r.status}
                      </Badge>
                      {r.error && (
                        <span className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {r.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t("fileUpload.closing")}</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
