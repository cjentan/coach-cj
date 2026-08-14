"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { setDefaultUnits, type Units } from "@/lib/utils";

const STORAGE_KEY = "coach-units";

interface UnitsContextValue {
  units: Units;
  setUnits: (units: Units) => void;
  loading: boolean;
}

const UnitsContext = createContext<UnitsContextValue>({
  units: "metric",
  setUnits: () => {},
  loading: true,
});

function getStoredUnits(): Units {
  if (typeof window === "undefined") return "metric";
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "imperial" ? "imperial" : "metric";
}

/**
 * Provides the active measurement system ("metric" | "imperial") to the whole
 * app and keeps it in sync between localStorage and the server (the user's
 * `dashboardPrefs.units`). Toggling units updates the module-level default in
 * `@/lib/utils` so every `format*` helper reflects the choice without call
 * sites needing to thread the value through.
 */
export function UnitsProvider({ children }: { children: React.ReactNode }) {
  // Fast path: hydrate from localStorage during first render so the initial
  // paint (and the utils module default) matches the user's choice.
  const [units, setUnitsState] = useState<Units>(() => {
    const stored = getStoredUnits();
    setDefaultUnits(stored);
    return stored;
  });
  const [loading, setLoading] = useState(true);
  const userTouchedRef = useRef(false);

  // Load from the server (source of truth), falling back to localStorage.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((server: { units?: Units } | null) => {
        if (cancelled || userTouchedRef.current) return;
        const resolved: Units = server?.units ?? getStoredUnits();
        setUnitsState(resolved);
        setDefaultUnits(resolved);
        try {
          localStorage.setItem(STORAGE_KEY, resolved);
        } catch {
          /* storage full or unavailable — fine */
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled && !userTouchedRef.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setUnits = useCallback((next: Units) => {
    userTouchedRef.current = true;
    // Update the module default synchronously so the format* helpers reflect
    // the choice during the re-render the state change below triggers.
    setDefaultUnits(next);
    setUnitsState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage full or unavailable — fine */
    }
    // Server write is immediate (single value, low frequency).
    fetch("/api/dashboard/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ units: next }),
    }).catch(() => {
      /* background — don't block the UI */
    });
  }, []);

  const value = useMemo(() => ({ units, setUnits, loading }), [units, setUnits, loading]);

  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

export function useUnits() {
  const context = useContext(UnitsContext);
  if (!context) {
    throw new Error("useUnits must be used within a UnitsProvider");
  }
  return context;
}
