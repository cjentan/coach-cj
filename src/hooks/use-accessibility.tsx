"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";

export type TextSize = "normal" | "large" | "xlarge";

interface AccessibilityContextValue {
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
}

const AccessibilityContext = createContext<AccessibilityContextValue>({
  textSize: "normal",
  setTextSize: () => {},
});

const TEXT_SIZE_STORAGE_KEY = "coach-text-size";

function getStoredTextSize(): TextSize {
  if (typeof window === "undefined") return "normal";
  const stored = localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
  if (stored === "large" || stored === "xlarge") return stored;
  return "normal";
}

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [textSize, setTextSizeState] = useState<TextSize>("normal");
  const [mounted, setMounted] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    setTextSizeState(getStoredTextSize());
    setMounted(true);
  }, []);

  // Apply data attribute and persist whenever textSize changes
  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-text-size", textSize);
    localStorage.setItem(TEXT_SIZE_STORAGE_KEY, textSize);
  }, [textSize, mounted]);

  const setTextSize = useCallback((size: TextSize) => {
    setTextSizeState(size);
  }, []);

  const value = useMemo(() => ({ textSize, setTextSize }), [textSize, setTextSize]);

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

export function useAccessibility() {
  const context = useContext(AccessibilityContext);
  if (!context) {
    throw new Error("useAccessibility must be used within an AccessibilityProvider");
  }
  return context;
}
