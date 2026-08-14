import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardPrefs } from "@/app/api/dashboard/preferences/route";

const STORAGE_KEY = "coach-dashboard-prefs";

const DEFAULTS: DashboardPrefs = {
  timeframeDays: 30,
  pmcMetrics: ["ctl", "tsb"],
  volumePeriod: "week",
  units: "metric",
};

/**
 * Load cached prefs from localStorage (fast path for initial render).
 * Returns null if nothing is cached or the value is corrupt.
 */
function loadLocal(): DashboardPrefs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.timeframeDays === "number" &&
      Array.isArray(parsed.pmcMetrics) &&
      ["week", "month"].includes(parsed.volumePeriod)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function saveLocal(prefs: DashboardPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage full or unavailable — fine */
  }
}

/**
 * Hook that syncs dashboard chart preferences between the server (DB) and
 * localStorage. Preferences survive logouts and browser refreshes.
 *
 * The contract is simple: call `setPrefs(partial)` whenever something changes,
 * and read from the returned `prefs` for all chart state.
 */
export function useDashboardPrefs() {
  const [prefs, setPrefsState] = useState<DashboardPrefs>(() => loadLocal() ?? DEFAULTS);
  const [loading, setLoading] = useState(true);
  const loadedOnce = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<DashboardPrefs | null>(null);

  // — 1. Load from server on mount, merging with local as a tiebreaker —
  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((server: DashboardPrefs | null) => {
        if (cancelled) return;
        const local = loadLocal();
        // Server is the source of truth; fall back to local if unavailable
        const merged = server ?? local ?? DEFAULTS;
        setPrefsState(merged);
        saveLocal(merged);
        setLoading(false);
        loadedOnce.current = true;
      })
      .catch(() => {
        // Network error — keep whatever we have from localStorage
        if (!cancelled) {
          setLoading(false);
          loadedOnce.current = true;
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // — 2. Save to server (debounced) whenever prefs change —
  const persistToServer = useCallback((latest: DashboardPrefs) => {
    // Send only the dashboard keys. `units` is owned by the UnitsProvider and
    // written via the same endpoint — including it here could overwrite the
    // user's choice with a stale value from this hook's local copy.
    fetch("/api/dashboard/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timeframeDays: latest.timeframeDays,
        pmcMetrics: latest.pmcMetrics,
        volumePeriod: latest.volumePeriod,
      }),
    }).catch(() => {
      /* background — don't block the UI */
    });
  }, []);

  // — 3. Public setter: merges partial, saves to localStorage immediately, and
  //    debounces the server write.
  const setPrefs = useCallback(
    (partial: Partial<DashboardPrefs>) => {
      setPrefsState((prev) => {
        const next = { ...prev, ...partial };
        // LocalStorage is synchronous — update immediately so it survives
        // a tab-close before the server write finishes.
        saveLocal(next);

        // Debounce the server write
        pendingRef.current = next;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          if (pendingRef.current) {
            persistToServer(pendingRef.current);
            pendingRef.current = null;
          }
        }, 800);

        return next;
      });
    },
    [persistToServer],
  );

  return { prefs, setPrefs, loading };
}
