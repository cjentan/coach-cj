"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { ActivityCard, TrainingLog, RouteMatch, DuplicateGroupInfo } from "@/components/activity/activity-card";
import { COACH_CHAT_EVENTS } from "@/lib/coach-chat-events";

export default function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations("activities");
  const common = useTranslations("common");
  const [log, setLog] = useState<TrainingLog | null>(null);
  const [neighbors, setNeighbors] = useState<{ prev: TrainingLog | null; next: TrainingLog | null }>({ prev: null, next: null });
  const [loading, setLoading] = useState(true);
  const [sliding, setSliding] = useState<"left" | "right" | null>(null);
  const [remarksText, setRemarksText] = useState("");
  const [remarksDirty, setRemarksDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>();
  const [coachAnalysisText, setCoachAnalysisText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);
  const [isRace, setIsRace] = useState(false);
  const [isRaceDirty, setIsRaceDirty] = useState(false);
  const [similarRoutes, setSimilarRoutes] = useState<RouteMatch[]>([]);
  const [duplicateGroup, setDuplicateGroup] = useState<DuplicateGroupInfo | null>(null);
  const touchRef = useRef<{ startX: number; startY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Navigate back to activities list preserving any position params
  function backToActivities() {
    const params = new URLSearchParams(window.location.search);
    const fwd = new URLSearchParams();
    const vm = params.get("vm");
    const off = params.get("off");
    const bar = params.get("bar");
    if (vm) fwd.set("vm", vm);
    if (off) fwd.set("off", off);
    if (bar) fwd.set("bar", bar);
    const qs = fwd.toString();
    router.push(`/activities${qs ? `?${qs}` : ""}`);
  }

  async function handleDelete() {
    if (!log) return;
    if (!confirm(t("detail.deleteConfirm", { name: log.name }))) return;
    setDeleting(true);
    try {
      await fetch(`/api/activities/${id}`, { method: "DELETE" });
      backToActivities();
    } catch {
      alert(t("detail.deleteFailed"));
      setDeleting(false);
    }
  }

  const fetchLog = useCallback(() => {
    setLoading(true);
    fetch(`/api/activities/${id}?neighbors=full`)
      .then((r) => r.json())
      .then((data) => {
        const l = data.log || data;
        setLog(l);
        setRemarksText(l.remarks || "");
        setCoachAnalysisText(l.coachAnalysis || "");
        setAnalysisStatus(l.analysisStatus || null);
        setIsRace(l.isRace);
        setIsRaceDirty(false);
        setAnalyzeError(null);
        setRemarksDirty(false);
        setSaved(false);
        setNeighbors({ prev: data.prev ?? null, next: data.next ?? null });
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchLog(); }, [fetchLog]);

  // Refresh when a chat-saved analysis is persisted for this activity
  useEffect(() => {
    function onAnalysisSaved(e: Event) {
      const detail = (e as CustomEvent).detail as { activityId?: string } | undefined;
      if (detail?.activityId === id) fetchLog();
    }
    window.addEventListener(COACH_CHAT_EVENTS.ACTIVITY_ANALYSIS_SAVED, onAnalysisSaved);
    return () => window.removeEventListener(COACH_CHAT_EVENTS.ACTIVITY_ANALYSIS_SAVED, onAnalysisSaved);
  }, [id, fetchLog]);

  // Fetch similar routes when log changes
  useEffect(() => {
    if (!id) return;
    fetch(`/api/activities/${id}/similar`)
      .then((r) => r.json())
      .then((data) => setSimilarRoutes(data.matches || []))
      .catch(() => setSimilarRoutes([]));
  }, [id]);


  // Fetch duplicate info
  useEffect(() => {
    if (!log?.duplicateGroupId) { setDuplicateGroup(null); return; }
    fetch(`/api/duplicates/list?status=pending`)
      .then((r) => r.ok ? r.json() : { groups: [] })
      .then((data) => {
        const g = data.groups?.find((g: DuplicateGroupInfo) => g.id === log.duplicateGroupId);
        setDuplicateGroup(g || null);
      })
      .catch(() => setDuplicateGroup(null));
  }, [log?.duplicateGroupId]);

  // Poll analysis status while pending or processing
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  useEffect(() => {
    const shouldPoll = !analyzing && (analysisStatus === "pending" || analysisStatus === "processing");

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = undefined;
    }

    if (shouldPoll) {
      pollRef.current = setInterval(() => {
        fetch(`/api/activities/${id}?neighbors=full`)
          .then((r) => r.json())
          .then((data) => {
            const l = data.log || data;
            if (l.analysisStatus !== analysisStatus || l.coachAnalysis !== coachAnalysisText) {
              setAnalysisStatus(l.analysisStatus || null);
              setCoachAnalysisText(l.coachAnalysis || "");
              setAnalyzeError(null);
            }
          })
          .catch(() => {});
      }, 5000);
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = undefined;
      }
    };
  }, [id, analyzing, analysisStatus, coachAnalysisText]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    };
  }, []);

  // Auto-save remarks with debounce
  const saveRemarks = useCallback(async (text: string) => {
    await fetch(`/api/activities/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remarks: text || null }),
    });
  }, [id]);

  const saveIsRace = useCallback(async (value: boolean) => {
    await fetch(`/api/activities/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRace: value }),
    });
  }, [id]);

  function handleRemarksChange(text: string) {
    setRemarksText(text);
    setRemarksDirty(true);
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await saveRemarks(text);
      setRemarksDirty(false);
      setSaved(true);
      feedbackTimer.current = setTimeout(() => setSaved(false), 2000);
    }, 800);
  }

  function handleIsRaceChange(value: boolean) {
    setIsRace(value);
    setIsRaceDirty(true);
    saveIsRace(value).then(() => {
      setIsRaceDirty(false);
    });
  }

  // Analyze with AI Coach
  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch("/api/dashboard/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "analyze-activity", activityId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("detail.analysisFailed"));
      setCoachAnalysisText(data.analysis);
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : t("detail.analysisFailed"));
    }
    setAnalyzing(false);
  }, [id]);

  // Clear coach analysis
  const handleClearAnalysis = useCallback(async () => {
    if (!confirm(t("detail.clearAnalysisConfirm"))) return;
    try {
      await fetch(`/api/activities/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearAnalysis: true }),
      });
      setCoachAnalysisText("");
      setAnalysisStatus(null);
      setAnalyzeError(null);
    } catch {
      alert(t("detail.clearAnalysisFailed"));
    }
  }, [id]);

  // Carousel navigation — use preloaded data when available, fetch if not
  const navigateTo = useCallback((newId: string, preloadedLog?: TrainingLog | null) => {
    if (!newId) return;
    if (preloadedLog) {
      // Instant — data is already loaded
      setLog(preloadedLog);
      setRemarksText(preloadedLog.remarks || "");
      setRemarksDirty(false);
      setSaved(false);
      // Fetch new neighbors in the background
      fetch(`/api/activities/${newId}?neighbors=full`)
        .then((r) => r.json())
        .then((data) => {
          if (data.log) setLog(data.log);
          setNeighbors({ prev: data.prev ?? null, next: data.next ?? null });
        });
      router.replace(`/activities/${newId}`, { scroll: false });
      return;
    }
    // Fallback: fetch from server
    fetch(`/api/activities/${newId}?neighbors=full`)
      .then((r) => r.json())
      .then((data) => {
        const l = data.log || data;
        setLog(l);
        setRemarksText(l.remarks || "");
        setRemarksDirty(false);
        setSaved(false);
        setNeighbors({ prev: data.prev ?? null, next: data.next ?? null });
        router.replace(`/activities/${newId}`, { scroll: false });
      });
  }, [router]);

  // Touch swipe with smooth carousel animation
  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      const t = e.touches[0];
      touchRef.current = { startX: t.clientX, startY: t.clientY };
    }

    function onTouchMove(e: TouchEvent) {
      if (!touchRef.current) return;
      // Prevent browser back/forward swipe gesture
      const t = e.touches[0];
      const dx = t.clientX - touchRef.current.startX;
      const dy = t.clientY - touchRef.current.startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
        e.preventDefault();
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (!touchRef.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchRef.current.startX;
      const dy = t.clientY - touchRef.current.startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
        if (dx < 0 && neighbors.next?.id) {
          navigateTo(neighbors.next.id, neighbors.next);
        }
        if (dx > 0 && neighbors.prev?.id) {
          navigateTo(neighbors.prev.id, neighbors.prev);
        }
      }
      touchRef.current = null;
    }

    // Keyboard navigation
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft" && neighbors.prev?.id) navigateTo(neighbors.prev.id, neighbors.prev);
      if (e.key === "ArrowRight" && neighbors.next?.id) navigateTo(neighbors.next.id, neighbors.next);
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", onTouchStart, { passive: false });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [neighbors, navigateTo]);

  if (loading) return <div className="container mx-auto px-4 py-8">{common("loading")}</div>;
  if (!log) return <div className="container mx-auto px-4 py-8 text-center">{t("detail.notFound")}</div>;

  const prevId = neighbors.prev?.id;
  const nextId = neighbors.next?.id;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Navigation bar */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" onClick={backToActivities}>
          <ArrowLeft className="h-4 w-4 mr-2" /> {t("detail.back")}
        </Button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="sm"
            disabled={!prevId}
            onClick={() => prevId && navigateTo(prevId, neighbors.prev)}
            title={t("detail.prevTooltip")}
          >
            <ChevronLeft className="h-5 w-5" /> {t("detail.prev")}
          </Button>
          <span className="text-xs text-muted-foreground px-1 hidden sm:inline">{t("detail.swipeHint")}</span>
          <Button
            variant="ghost" size="sm"
            disabled={!nextId}
            onClick={() => nextId && navigateTo(nextId, neighbors.next)}
            title={t("detail.nextTooltip")}
          >
            {t("detail.next")} <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Swipeable card area */}
      <div ref={containerRef} className="relative overflow-hidden touch-pan-y">
        <div className="transition-transform duration-200 ease-out">
          <ActivityCard
            log={log}
            remarksText={remarksText}
            remarksDirty={remarksDirty}
            saved={saved}
            deleting={deleting}
            similarRoutes={similarRoutes}
            duplicateGroup={duplicateGroup}
            onRemarksChange={handleRemarksChange}
            onDelete={handleDelete}
            coachAnalysisText={coachAnalysisText}
            analyzing={analyzing}
            analyzeError={analyzeError}
            analysisStatus={analysisStatus}
            onAnalyze={handleAnalyze}
            onClearAnalysis={handleClearAnalysis}
            isRace={isRace}
            isRaceDirty={isRaceDirty}
            onIsRaceChange={handleIsRaceChange}
          />
        </div>

        {/* Swipe hints on mobile */}
        <div className="flex sm:hidden items-center justify-between mt-3 px-1">
          <Button
            variant="ghost" size="sm"
            disabled={!prevId}
            onClick={() => prevId && navigateTo(prevId, neighbors.prev)}
          >
            <ChevronLeft className="h-5 w-5" /> {t("detail.prev")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("detail.swipeToNavigate")}
          </span>
          <Button
            variant="ghost" size="sm"
            disabled={!nextId}
            onClick={() => nextId && navigateTo(nextId, neighbors.next)}
          >
            {t("detail.next")} <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Bottom nav — desktop only */}
      <div className="hidden sm:flex items-center justify-between mt-4">
        <Button
          variant="outline" size="sm"
          disabled={!prevId}
          onClick={() => prevId && navigateTo(prevId, neighbors.prev)}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> {t("detail.previous")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("detail.keyboardHint")}</span>
        <Button
          variant="outline" size="sm"
          disabled={!nextId}
          onClick={() => nextId && navigateTo(nextId, neighbors.next)}
        >
          {t("detail.next")} <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
