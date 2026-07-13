"use client"

import { useState, useEffect, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dumbbell, Plus, Pencil, Trash2, Mountain, Route } from "lucide-react"
import { formatDistance } from "@/lib/utils"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Facility {
  id: string
  name: string
  type: string
  distanceMeters: number | null
  elevationGainMeters: number | null
  surface: string | null
  notes: string | null
}

interface FacilityFormData {
  name: string
  type: string
  distanceMeters: string
  elevationGainMeters: string
  surface: string
  notes: string
}

const defaultForm: FacilityFormData = {
  name: "",
  type: "road",
  distanceMeters: "",
  elevationGainMeters: "",
  surface: "",
  notes: "",
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_OPTIONS = [
  { value: "road", label: "Road" },
  { value: "trail", label: "Trail" },
  { value: "track", label: "Track" },
  { value: "trainer", label: "Trainer" },
  { value: "pool", label: "Pool" },
  { value: "gym", label: "Gym" },
] as const

const SURFACE_OPTIONS = [
  { value: "tarmac", label: "Tarmac" },
  { value: "gravel", label: "Gravel" },
  { value: "trail", label: "Trail" },
  { value: "track", label: "Track" },
  { value: "treadmill", label: "Treadmill" },
  { value: "trainer", label: "Trainer" },
] as const

const TYPE_BADGE_VARIANTS: Record<string, string> = {
  road: "default",
  trail: "secondary",
  track: "outline",
  trainer: "destructive",
  pool: "secondary",
  gym: "default",
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function SettingsFacilitiesPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [facilities, setFacilities] = useState<Facility[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<FacilityFormData>(defaultForm)
  const [saving, setSaving] = useState(false)

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Redirect unauthenticated users
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin")
    }
  }, [status, router])

  // Fetch facilities
  const fetchFacilities = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch("/api/facilities")
      if (!res.ok) throw new Error("Failed to fetch facilities")
      const data = await res.json()
      setFacilities(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === "authenticated") {
      fetchFacilities()
    }
  }, [status, fetchFacilities])

  // ---- Form helpers ----

  const openAddForm = () => {
    setEditingId(null)
    setFormData(defaultForm)
    setShowForm(true)
  }

  const openEditForm = (facility: Facility) => {
    setEditingId(facility.id)
    setFormData({
      name: facility.name,
      type: facility.type,
      distanceMeters: facility.distanceMeters?.toString() ?? "",
      elevationGainMeters: facility.elevationGainMeters?.toString() ?? "",
      surface: facility.surface ?? "",
      notes: facility.notes ?? "",
    })
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const cancelForm = () => {
    setShowForm(false)
    setEditingId(null)
    setFormData(defaultForm)
  }

  const handleFieldChange = (field: keyof FacilityFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const body: Record<string, unknown> = {
        name: formData.name,
        type: formData.type,
      }
      if (formData.distanceMeters) body.distanceMeters = Number(formData.distanceMeters)
      if (formData.elevationGainMeters) body.elevationGainMeters = Number(formData.elevationGainMeters)
      if (formData.surface) body.surface = formData.surface
      if (formData.notes) body.notes = formData.notes

      const url = editingId ? `/api/facilities/${editingId}` : "/api/facilities"
      const method = editingId ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error ?? `Failed to ${editingId ? "update" : "create"} facility`)
      }

      await fetchFacilities()
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
      const res = await fetch(`/api/facilities/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error ?? "Failed to delete facility")
      }
      setFacilities((prev) => prev.filter((f) => f.id !== id))
      setDeleteConfirm(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setDeleting(false)
    }
  }

  // ---- Auth gate ----

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (status === "unauthenticated") {
    return null
  }

  // ---- Render ----

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Facilities</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your training facilities — routes, tracks, pools, gyms, and more.
          </p>
        </div>
        <Button onClick={openAddForm} disabled={showForm}>
          <Plus className="mr-2 h-4 w-4" />
          Add Facility
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-6">
          {error}
        </div>
      )}

      {/* Add / Edit Form */}
      {showForm && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>{editingId ? "Edit Facility" : "New Facility"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Name */}
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g. Riverside Park Loop"
                    value={formData.name}
                    onChange={(e) => handleFieldChange("name", e.target.value)}
                    required
                  />
                </div>

                {/* Type */}
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(v) => handleFieldChange("type", v)}
                  >
                    <SelectTrigger id="type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Surface */}
                <div className="space-y-2">
                  <Label htmlFor="surface">Surface</Label>
                  <Select
                    value={formData.surface}
                    onValueChange={(v) => handleFieldChange("surface", v)}
                  >
                    <SelectTrigger id="surface">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      {SURFACE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Distance */}
                <div className="space-y-2">
                  <Label htmlFor="distance">Distance (metres)</Label>
                  <Input
                    id="distance"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="e.g. 5000"
                    value={formData.distanceMeters}
                    onChange={(e) => handleFieldChange("distanceMeters", e.target.value)}
                  />
                </div>

                {/* Elevation */}
                <div className="space-y-2">
                  <Label htmlFor="elevation">Elevation gain (metres)</Label>
                  <Input
                    id="elevation"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="e.g. 120"
                    value={formData.elevationGainMeters}
                    onChange={(e) => handleFieldChange("elevationGainMeters", e.target.value)}
                  />
                </div>

                {/* Notes */}
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="notes">Notes</Label>
                  <textarea
                    id="notes"
                    rows={3}
                    placeholder="Optional notes…"
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

              {/* Buttons */}
              <div className="flex items-center gap-3 pt-2">
                <Button type="submit" disabled={saving || !formData.name.trim()}>
                  {saving ? "Saving…" : editingId ? "Update Facility" : "Create Facility"}
                </Button>
                <Button type="button" variant="outline" onClick={cancelForm} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          Loading facilities…
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && facilities.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Dumbbell className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-semibold mb-1">No facilities yet</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-xs">
            Add your first training facility — a route, track, pool, or gym — to get started.
          </p>
          <Button onClick={openAddForm}>
            <Plus className="mr-2 h-4 w-4" />
            Add Facility
          </Button>
        </div>
      )}

      {/* Facility cards */}
      {!loading && facilities.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {facilities.map((facility) => (
            <Card key={facility.id} className="relative">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {TYPE_ICONS[facility.type] ?? <Dumbbell className="h-4 w-4" />}
                    <CardTitle className="text-lg">{facility.name}</CardTitle>
                  </div>
                  <Badge variant={TYPE_BADGE_VARIANTS[facility.type] as "default" | "secondary" | "outline" | "destructive" | undefined}>
                    {facility.type.charAt(0).toUpperCase() + facility.type.slice(1)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pb-3">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                  {facility.distanceMeters != null && (
                    <span>{formatDistance(facility.distanceMeters)}</span>
                  )}
                  {facility.elevationGainMeters != null && (
                    <span className="flex items-center gap-1">
                      <Mountain className="h-3.5 w-3.5" />
                      {facility.elevationGainMeters}m gain
                    </span>
                  )}
                  {facility.surface && (
                    <span className="capitalize">{facility.surface}</span>
                  )}
                  {facility.distanceMeters == null && facility.elevationGainMeters == null && !facility.surface && (
                    <span className="italic">No details</span>
                  )}
                </div>
                {facility.notes && (
                  <p className="mt-2 text-sm text-muted-foreground border-t pt-2 italic">
                    {facility.notes}
                  </p>
                )}
              </CardContent>
              <div className="flex items-center gap-1 px-6 pb-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEditForm(facility)}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  Edit
                </Button>

                {deleteConfirm === facility.id ? (
                  <div className="flex items-center gap-1 ml-auto">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deleting}
                      onClick={() => handleDelete(facility.id)}
                    >
                      {deleting ? "…" : "Confirm"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteConfirm(null)}
                      disabled={deleting}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-destructive hover:text-destructive"
                    onClick={() => setDeleteConfirm(facility.id)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Delete
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  road: <Route className="h-4 w-4" />,
  trail: <Mountain className="h-4 w-4" />,
  track: <Route className="h-4 w-4" />,
  trainer: <Dumbbell className="h-4 w-4" />,
  pool: <Dumbbell className="h-4 w-4" />,
  gym: <Dumbbell className="h-4 w-4" />,
}
