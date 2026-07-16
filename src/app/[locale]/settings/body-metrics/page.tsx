"use client";

import { useState, useEffect, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Plus, Trash2, Scale, Heart, TrendingDown, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BodyMetric {
  id: string
  recordedAt: string
  weightKg: number
  heightCm: number | null
  restingHr: number | null
  notes: string | null
}

interface MetricFormData {
  recordedAt: string
  weightKg: string
  heightCm: string
  restingHr: string
  notes: string
}

const defaultForm: MetricFormData = {
  recordedAt: new Date().toISOString().slice(0, 10),
  weightKg: "",
  heightCm: "",
  restingHr: "",
  notes: "",
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function averageWeight(metrics: BodyMetric[]): number | null {
  if (metrics.length === 0) return null
  const sum = metrics.reduce((acc, m) => acc + m.weightKg, 0)
  return Math.round((sum / metrics.length) * 10) / 10
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function SettingsBodyMetricsPage() {
  const t = useTranslations("settings.bodyMetrics")
  const common = useTranslations("common")

  const [metrics, setMetrics] = useState<BodyMetric[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState<MetricFormData>(defaultForm)
  const [saving, setSaving] = useState(false)

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Fetch metrics
  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch("/api/body-metrics")
      if (!res.ok) throw new Error("Failed to fetch body metrics")
      const data = await res.json()
      setMetrics(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics])

  // ---- Derived stats ----

  const sorted = [...metrics].sort(
    (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
  )

  const latestWeight: number | null = sorted[0]?.weightKg ?? null
  const avgWeight: number | null = averageWeight(sorted)

  // 7-day change: compare latest with the most recent entry older than 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const recentEnough = sorted.filter(
    (m) => new Date(m.recordedAt).getTime() >= sevenDaysAgo
  )
  const weekChange: number | null =
    recentEnough.length >= 2
      ? Math.round((recentEnough[0].weightKg - recentEnough[recentEnough.length - 1].weightKg) * 10) / 10
      : null

  // ---- Form helpers ----

  const openAddForm = () => {
    setFormData(defaultForm)
    setShowForm(true)
  }

  const cancelForm = () => {
    setShowForm(false)
    setFormData(defaultForm)
  }

  const handleFieldChange = (field: keyof MetricFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const body: Record<string, unknown> = {
        recordedAt: formData.recordedAt,
        weightKg: Number(formData.weightKg),
      }
      if (formData.heightCm) body.heightCm = Number(formData.heightCm)
      if (formData.restingHr) body.restingHr = Number(formData.restingHr)
      if (formData.notes) body.notes = formData.notes

      const res = await fetch("/api/body-metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error ?? "Failed to save body metric")
      }

      await fetchMetrics()
      cancelForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  // ---- Delete ----

  const handleDelete = async (id: string) => {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/body-metrics/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error ?? "Failed to delete entry")
      }
      setMetrics((prev) => prev.filter((m) => m.id !== id))
      setDeleteConfirm(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setDeleting(false)
    }
  }

  // ---- Render ----

  const weightTrend = weekChange !== null ? (weekChange > 0 ? "up" : weekChange < 0 ? "down" : "stable") : null

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("description")}
          </p>
        </div>
        <Button onClick={openAddForm} disabled={showForm}>
          <Plus className="mr-2 h-4 w-4" />
          {t("addEntry")}
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-6">
          {error}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Scale className="h-4 w-4" />
              {t("latestWeight")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {latestWeight != null ? `${latestWeight.toFixed(1)} ${t("unitKg")}` : "—"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              {weightTrend === "up" ? (
                <TrendingUp className="h-4 w-4 text-destructive" />
              ) : weightTrend === "down" ? (
                <TrendingDown className="h-4 w-4 text-green-500" />
              ) : (
                <Heart className="h-4 w-4" />
              )}
              {t("sevenDayChange")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={cn(
                "text-2xl font-bold",
                weekChange !== null && weekChange > 0 && "text-destructive",
                weekChange !== null && weekChange < 0 && "text-green-500"
              )}
            >
              {weekChange !== null
                ? `${weekChange > 0 ? "+" : ""}${weekChange.toFixed(1)} ${t("unitKg")}`
                : "—"}
            </p>
            {weekChange === null && sorted.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {t("needMoreEntries")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Heart className="h-4 w-4" />
              {t("averageWeight")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {avgWeight != null ? `${avgWeight.toFixed(1)} ${t("unitKg")}` : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Add form */}
      {showForm && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>{t("newEntry")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Date */}
                <div className="space-y-2">
                  <Label htmlFor="recordedAt">{t("date")}</Label>
                  <Input
                    id="recordedAt"
                    type="date"
                    value={formData.recordedAt}
                    onChange={(e) => handleFieldChange("recordedAt", e.target.value)}
                    required
                  />
                </div>

                {/* Weight */}
                <div className="space-y-2">
                  <Label htmlFor="weightKg">{t("formWeight")}</Label>
                  <Input
                    id="weightKg"
                    type="number"
                    min="20"
                    max="500"
                    step="0.1"
                    placeholder={t("weightPlaceholder")}
                    value={formData.weightKg}
                    onChange={(e) => handleFieldChange("weightKg", e.target.value)}
                    required
                  />
                </div>

                {/* Height */}
                <div className="space-y-2">
                  <Label htmlFor="heightCm">{t("formHeight")}</Label>
                  <Input
                    id="heightCm"
                    type="number"
                    min="100"
                    max="250"
                    step="1"
                    placeholder={t("heightPlaceholder")}
                    value={formData.heightCm}
                    onChange={(e) => handleFieldChange("heightCm", e.target.value)}
                  />
                </div>

                {/* Resting HR */}
                <div className="space-y-2">
                  <Label htmlFor="restingHr">{t("formRestingHr")}</Label>
                  <Input
                    id="restingHr"
                    type="number"
                    min="30"
                    max="220"
                    step="1"
                    placeholder={t("restingHrPlaceholder")}
                    value={formData.restingHr}
                    onChange={(e) => handleFieldChange("restingHr", e.target.value)}
                  />
                </div>

                {/* Notes */}
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="notes">{t("notes")}</Label>
                  <textarea
                    id="notes"
                    rows={2}
                    placeholder={t("notesPlaceholder")}
                    className={cn(
                      "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2",
                      "text-sm shadow-sm placeholder:text-muted-foreground",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                    value={formData.notes}
                    onChange={(e) => handleFieldChange("notes", e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button type="submit" disabled={saving || !formData.weightKg || !formData.recordedAt}>
                  {saving ? common("saving") : t("saveEntry")}
                </Button>
                <Button type="button" variant="outline" onClick={cancelForm} disabled={saving}>
                  {common("cancel")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          {t("loading")}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && metrics.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Heart className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-semibold mb-1">{t("noEntries")}</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-xs">
            {t("noEntriesDesc")}
          </p>
          <Button onClick={openAddForm}>
            <Plus className="mr-2 h-4 w-4" />
            {t("addEntry")}
          </Button>
        </div>
      )}

      {/* Table */}
      {!loading && metrics.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left font-medium px-4 py-3">{t("date")}</th>
                <th className="text-left font-medium px-4 py-3">{t("tableWeight")}</th>
                <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">{t("tableHeight")}</th>
                <th className="text-left font-medium px-4 py-3 hidden sm:table-cell">{t("tableRestingHr")}</th>
                <th className="text-left font-medium px-4 py-3 hidden md:table-cell">{t("notes")}</th>
                <th className="text-right font-medium px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((metric) => (
                <tr key={metric.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatDate(metric.recordedAt)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap font-medium">
                    {metric.weightKg.toFixed(1)} {t("unitKg")}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground hidden sm:table-cell">
                    {metric.heightCm != null ? `${metric.heightCm} ${t("unitCm")}` : "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground hidden sm:table-cell">
                    {metric.restingHr != null ? (
                      <span className="flex items-center gap-1">
                        <Heart className="h-3.5 w-3.5 text-rose-400" />
                        {metric.restingHr} {t("unitBpm")}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell max-w-[200px] truncate">
                    {metric.notes ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {deleteConfirm === metric.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={deleting}
                          onClick={() => handleDelete(metric.id)}
                        >
                          {deleting ? "…" : common("confirm")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteConfirm(null)}
                          disabled={deleting}
                        >
                          {common("cancel")}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteConfirm(metric.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="sr-only">{common("delete")}</span>
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
