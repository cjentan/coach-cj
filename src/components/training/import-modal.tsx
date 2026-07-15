"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Activity, Bike, Waves, Mountain, Footprints, Dumbbell,
  Upload, FileType, Pencil, CheckCircle2, XCircle, AlertCircle, Loader2,
} from "lucide-react";

// ── Shared constants ───────────────────────────────────────────────────

const ACTIVITY_TYPES = [
  { value: "run", label: "Run", icon: Activity },
  { value: "ride", label: "Ride", icon: Bike },
  { value: "swim", label: "Swim", icon: Waves },
  { value: "hike", label: "Hike", icon: Mountain },
  { value: "walk", label: "Walk", icon: Footprints },
  { value: "workout", label: "Workout", icon: Dumbbell },
  { value: "other", label: "Other", icon: Activity },
];

const SUB_TYPE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  run: [
    { value: "trail_running", label: "Trail Running" },
    { value: "treadmill", label: "Treadmill" },
    { value: "virtual_run", label: "Virtual Run" },
  ],
  ride: [
    { value: "mountain_biking", label: "Mountain Biking" },
    { value: "gravel_cycling", label: "Gravel Cycling" },
    { value: "road_cycling", label: "Road Cycling" },
    { value: "indoor_cycling", label: "Indoor Cycling" },
    { value: "virtual_ride", label: "Virtual Ride" },
    { value: "handcycle", label: "Handcycle" },
  ],
  swim: [
    { value: "open_water", label: "Open Water" },
    { value: "lap_swimming", label: "Lap Swimming" },
  ],
  workout: [
    { value: "strength_training", label: "Strength Training" },
    { value: "crossfit", label: "CrossFit" },
    { value: "yoga", label: "Yoga" },
    { value: "elliptical", label: "Elliptical" },
    { value: "stair_stepper", label: "Stair Stepper" },
    { value: "pilates", label: "Pilates" },
  ],
  other: [
    { value: "rock_climbing", label: "Rock Climbing" },
    { value: "surfing", label: "Surfing" },
    { value: "stand_up_paddling", label: "Stand Up Paddling" },
    { value: "kayaking", label: "Kayaking" },
    { value: "canoeing", label: "Canoeing" },
    { value: "rowing", label: "Rowing" },
    { value: "ice_skating", label: "Ice Skating" },
    { value: "inline_skating", label: "Inline Skating" },
    { value: "nordic_skiing", label: "Nordic Skiing" },
    { value: "alpine_skiing", label: "Alpine Skiing" },
    { value: "backcountry_skiing", label: "Backcountry Skiing" },
    { value: "snowboarding", label: "Snowboarding" },
    { value: "snowshoeing", label: "Snowshoeing" },
    { value: "soccer", label: "Soccer" },
    { value: "tennis", label: "Tennis" },
    { value: "golf", label: "Golf" },
    { value: "wheelchair", label: "Wheelchair" },
  ],
};

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Manual entry state ─────────────────────────────────────────────
  const [manualForm, setManualForm] = useState({
    name: "", type: "run", subType: "", date: new Date().toISOString().slice(0, 16),
    durationMinutes: "", durationSeconds: "", distance: "", elevation: "",
    avgHr: "", maxHr: "", calories: "", description: "",
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
      name: "", type: "run", subType: "", date: new Date().toISOString().slice(0, 16),
      durationMinutes: "", durationSeconds: "", distance: "", elevation: "",
      avgHr: "", maxHr: "", calories: "", description: "",
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

    const durationSec = (parseInt(manualForm.durationMinutes || "0") * 60) + parseInt(manualForm.durationSeconds || "0");
    if (durationSec <= 0) {
      setManualResult("Enter a valid duration");
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
        setManualResult(data.error || "Failed to create activity");
      }
    } catch {
      setManualResult("Network error — please try again");
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
      setUploadMessage("Upload failed — network error");
    }
    setUploading(false);
  }

  return (
    <Dialog open={open} onOpenChange={(open) => {
      if (!open) resetForms();
      onOpenChange(open);
    }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Activity</DialogTitle>
          <DialogDescription>
            Log a manual entry or upload GPX/TCX/FIT files from your device
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="manual" className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual"><Pencil className="h-4 w-4 mr-2" /> Manual Entry</TabsTrigger>
            <TabsTrigger value="upload"><Upload className="h-4 w-4 mr-2" /> File Upload</TabsTrigger>
          </TabsList>

          {/* ── Manual Entry Tab ─────────────────────────── */}
          <TabsContent value="manual" className="space-y-4 mt-4">
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Activity Name *</Label>
                  <Input value={manualForm.name} onChange={(e) => setManualForm({ ...manualForm, name: e.target.value })}
                    placeholder="Morning Run" required />
                </div>
                <div className="space-y-2">
                  <Label>Type *</Label>
                  <Select value={manualForm.type} onValueChange={(v) => { setManualForm({ ...manualForm, type: v, subType: "" }); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ACTIVITY_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          <span className="flex items-center gap-2"><t.icon className="h-4 w-4" /> {t.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {SUB_TYPE_OPTIONS[manualForm.type] && SUB_TYPE_OPTIONS[manualForm.type].length > 0 && (
                  <div className="space-y-2">
                    <Label>Sub-Type</Label>
                    <Select value={manualForm.subType} onValueChange={(v) => setManualForm({ ...manualForm, subType: v })}>
                      <SelectTrigger><SelectValue placeholder="None (generic)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None (generic)</SelectItem>
                        {SUB_TYPE_OPTIONS[manualForm.type].map((st) => (
                          <SelectItem key={st.value} value={st.value}>{st.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Date & Time *</Label>
                  <Input type="datetime-local" value={manualForm.date}
                    onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>Duration *</Label>
                  <div className="flex gap-2">
                    <Input type="number" placeholder="Min" value={manualForm.durationMinutes}
                      onChange={(e) => setManualForm({ ...manualForm, durationMinutes: e.target.value })} />
                    <Input type="number" placeholder="Sec" value={manualForm.durationSeconds}
                      onChange={(e) => setManualForm({ ...manualForm, durationSeconds: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Distance (meters)</Label>
                  <Input type="number" value={manualForm.distance}
                    onChange={(e) => setManualForm({ ...manualForm, distance: e.target.value })} placeholder="12000" />
                </div>
                <div className="space-y-2">
                  <Label>Elevation Gain (meters)</Label>
                  <Input type="number" value={manualForm.elevation}
                    onChange={(e) => setManualForm({ ...manualForm, elevation: e.target.value })} placeholder="450" />
                </div>
                <div className="space-y-2">
                  <Label>Avg Heart Rate (bpm)</Label>
                  <Input type="number" value={manualForm.avgHr}
                    onChange={(e) => setManualForm({ ...manualForm, avgHr: e.target.value })} placeholder="142" />
                </div>
                <div className="space-y-2">
                  <Label>Max Heart Rate (bpm)</Label>
                  <Input type="number" value={manualForm.maxHr}
                    onChange={(e) => setManualForm({ ...manualForm, maxHr: e.target.value })} placeholder="172" />
                </div>
                <div className="space-y-2">
                  <Label>Calories</Label>
                  <Input type="number" value={manualForm.calories}
                    onChange={(e) => setManualForm({ ...manualForm, calories: e.target.value })} placeholder="450" />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Notes</Label>
                  <Input value={manualForm.description}
                    onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })}
                    placeholder="Felt strong, negative split..." />
                </div>
              </div>

              {manualResult && (
                <div className={`p-3 rounded-md text-sm ${manualResult.includes("success") || manualResult.includes("created")
                  ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
                  : "bg-destructive/10 text-destructive"
                }`}>
                  {manualResult}
                </div>
              )}

              <Button type="submit" disabled={manualSubmitting}>
                {manualSubmitting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
                ) : (
                  <><Pencil className="h-4 w-4 mr-2" /> Log Activity</>
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
                <p className="font-medium mb-1">Click to select GPX, TCX, or FIT files</p>
                <p className="text-sm text-muted-foreground">You can select multiple files at once</p>
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
                <p className="text-sm font-medium">{files.length} file{files.length !== 1 ? "s" : ""} selected</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm p-1.5 rounded bg-muted/50">
                      <FileType className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1">{f.name}</span>
                      <span className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-2">
                  <Button onClick={handleFileUpload}>
                    <Upload className="h-4 w-4 mr-2" /> Upload {files.length} file{files.length !== 1 ? "s" : ""}
                  </Button>
                  <Button variant="outline" onClick={() => { setFiles([]); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Uploading */}
            {uploading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-lg p-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Parsing and importing files…
              </div>
            )}

            {/* Results */}
            {fileResults.length > 0 && (
              <div className="space-y-3">
                <div className={`p-3 rounded-lg text-sm ${
                  uploadMessage?.includes("Imported")
                    ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
                    : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                }`}>
                  {uploadMessage}
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {fileResults.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm p-2 rounded bg-muted/50">
                      {r.status === "imported" ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" /> :
                       r.status === "skipped" ? <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" /> :
                       <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                      <span className="flex-1 truncate">{r.filename}</span>
                      <Badge variant={r.status === "imported" ? "success" : r.status === "skipped" ? "warning" : "destructive"}>
                        {r.status}
                      </Badge>
                      {r.error && <span className="text-xs text-muted-foreground max-w-[200px] truncate">{r.error}</span>}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Closing automatically…</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
