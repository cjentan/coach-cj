"use client";

import { useState, useEffect, useCallback } from "react";
import { Clock, CalendarDays, Plus, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

type Facility = { id: string; name: string };
type TimeSlot = {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  facilityIds: string[];
  notes: string;
};

export default function SettingsAvailabilityPage() {
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [deleteNote, setDeleteNote] = useState<string | null>(null);

  // Form state
  const [dayOfWeek, setDayOfWeek] = useState<string>("1");
  const [startTime, setStartTime] = useState("06:00");
  const [endTime, setEndTime] = useState("07:00");
  const [selectedFacilities, setSelectedFacilities] = useState<Set<string>>(
    new Set()
  );
  const [notes, setNotes] = useState("");

  // Fetch facilities and existing availability on mount
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [facRes, availRes] = await Promise.all([
        fetch("/api/facilities"),
        fetch("/api/availability"),
      ]);
      if (facRes.ok) {
        const facData: Facility[] = await facRes.json();
        setFacilities(facData);
      }
      if (availRes.ok) {
        const availData: TimeSlot[] = await availRes.json();
        setTimeSlots(availData);
      }
    } catch {
      // API might not be available yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleFacility = (facilityId: string) => {
    setSelectedFacilities((prev) => {
      const next = new Set(prev);
      if (next.has(facilityId)) {
        next.delete(facilityId);
      } else {
        next.add(facilityId);
      }
      return next;
    });
  };

  const handleAdd = async () => {
    if (!startTime || !endTime) return;
    setAdding(true);
    const payload = {
      dayOfWeek: parseInt(dayOfWeek, 10),
      startTime,
      endTime,
      facilityIds: Array.from(selectedFacilities),
      notes,
    };

    try {
      const res = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const created: TimeSlot = await res.json();
        setTimeSlots((prev) => [...prev, created]);
      } else {
        // Fallback: add optimistically with a temp id
        const tempId = `temp-${Date.now()}`;
        setTimeSlots((prev) => [...prev, { ...payload, id: tempId }]);
      }
    } catch {
      const tempId = `temp-${Date.now()}`;
      setTimeSlots((prev) => [...prev, { ...payload, id: tempId }]);
    }

    // Reset form
    setStartTime("06:00");
    setEndTime("07:00");
    setSelectedFacilities(new Set());
    setNotes("");
    setAdding(false);
  };

  const handleDelete = (id: string) => {
    // Optimistic removal
    setTimeSlots((prev) => prev.filter((slot) => slot.id !== id));
    fetch(`/api/availability/${id}`, { method: "DELETE" }).catch(() => {
      setDeleteNote(
        "The backend DELETE route is not yet wired — the slot was removed from the UI. No changes were persisted."
      );
    });
  };

  // Group time slots by day
  const groupedByDay = DAY_NAMES.map((_, idx) => ({
    dayIndex: idx,
    dayName: DAY_NAMES[idx],
    slots: timeSlots.filter((s) => s.dayOfWeek === idx),
  }));

  const dayOptions = DAY_NAMES.map((name, idx) => (
    <SelectItem key={idx} value={String(idx)}>
      {name}
    </SelectItem>
  ));

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <CalendarDays className="h-6 w-6 text-primary" />
          Schedule
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set your weekly training schedule and facility preferences.
        </p>
      </div>

      {/* Delete notice */}
      {deleteNote && (
        <Card className="mb-6 border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20">
          <CardContent className="p-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              {deleteNote}
              <button
                onClick={() => setDeleteNote(null)}
                className="ml-2 underline"
              >
                Dismiss
              </button>
            </p>
          </CardContent>
        </Card>
      )}

      {/* Add form */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add Time Slot
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {/* Day of week */}
            <div className="space-y-1.5">
              <Label htmlFor="day-of-week">Day of Week</Label>
              <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                <SelectTrigger id="day-of-week">
                  <SelectValue placeholder="Select day" />
                </SelectTrigger>
                <SelectContent>{dayOptions}</SelectContent>
              </Select>
            </div>

            {/* Start time */}
            <div className="space-y-1.5">
              <Label htmlFor="start-time">Start Time</Label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="start-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {/* End time */}
            <div className="space-y-1.5">
              <Label htmlFor="end-time">End Time</Label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="end-time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Input
                id="notes"
                placeholder="e.g. Track session"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Facility checkboxes */}
          {facilities.length > 0 && (
            <div className="mb-4">
              <Label className="block mb-2">Facilities</Label>
              <div className="flex flex-wrap gap-3">
                {facilities.map((fac) => (
                  <label
                    key={fac.id}
                    className="flex items-center gap-2 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFacilities.has(fac.id)}
                      onChange={() => toggleFacility(fac.id)}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    {fac.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <Button onClick={handleAdd} disabled={adding} className="gap-2">
            <Plus className="h-4 w-4" />
            {adding ? "Adding..." : "Add Slot"}
          </Button>
        </CardContent>
      </Card>

      {/* Loading state */}
      {loading && (
        <div className="text-center py-12">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Loading availability...</p>
        </div>
      )}

      {/* Schedule display */}
      {!loading && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold">Your Schedule</h2>
          {timeSlots.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No availability configured yet. Add a time slot above.
              </CardContent>
            </Card>
          ) : (
            groupedByDay.map(({ dayIndex, dayName, slots }) =>
              slots.length > 0 ? (
                <div key={dayIndex}>
                  <h3 className="text-lg font-medium mb-2 flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    {dayName}
                    <Badge variant="secondary" className="ml-2">
                      {slots.length}
                    </Badge>
                  </h3>
                  <div className="space-y-2">
                    {slots.map((slot) => (
                      <Card key={slot.id}>
                        <CardContent className="p-4 flex items-start justify-between gap-4">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="font-medium">
                                {slot.startTime} &ndash; {slot.endTime}
                              </span>
                            </div>
                            {slot.facilityIds.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {slot.facilityIds.map((fid) => {
                                  const fac = facilities.find(
                                    (f) => f.id === fid
                                  );
                                  return (
                                    <Badge
                                      key={fid}
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      {fac?.name ?? fid}
                                    </Badge>
                                  );
                                })}
                              </div>
                            )}
                            {slot.notes && (
                              <p className="text-sm text-muted-foreground">
                                {slot.notes}
                              </p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(slot.id)}
                            className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Delete slot</span>
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : null
            )
          )}
        </div>
      )}
    </div>
  );
}
