import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDistance(meters: number, type?: string): string {
  // Swims: always show in meters (pool distances are typically < 5km)
  if (type === "swim") {
    return `${Math.round(meters)} m`;
  }
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}

export function formatPace(metersPerSecond: number, type?: string): string {
  if (metersPerSecond === 0) return "--:--";
  // Rides: show speed in km/h
  if (type === "ride") {
    return `${(metersPerSecond * 3.6).toFixed(1)} km/h`;
  }
  // Swims: pace as min/100m
  if (type === "swim") {
    const minPer100m = 100 / metersPerSecond / 60;
    const minutes = Math.floor(minPer100m);
    const seconds = Math.round((minPer100m - minutes) * 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")} /100m`;
  }
  // Runs & others: pace as min/km
  const minPerKm = 1000 / metersPerSecond / 60;
  const minutes = Math.floor(minPerKm);
  const seconds = Math.round((minPerKm - minutes) * 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")} /km`;
}

export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function getWeekLabel(date: Date): string {
  const start = getWeekStart(date);
  const end = getWeekEnd(date);
  const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endStr = end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${startStr} – ${endStr}`;
}

export function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}
