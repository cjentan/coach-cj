"use client";

import { forwardRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Send } from "lucide-react";

// ── Component Props ───────────────────────────────────────

interface CoachInputBarProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  placeholder: string;
  loading?: boolean;
  className?: string;
}

// ── Component ─────────────────────────────────────────────

const CoachInputBar = forwardRef<HTMLTextAreaElement, CoachInputBarProps>(function CoachInputBar(
  { input, onInputChange, onSend, disabled, placeholder, loading, className },
  ref
) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    },
    [onSend]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onInputChange(e.target.value);
      e.target.style.height = "auto";
      e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
    },
    [onInputChange]
  );

  return (
    <div className={`flex gap-2${className ? ` ${className}` : ""}`}>
      <textarea
        ref={ref}
        value={input}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className="flex-1 min-h-[40px] max-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
      />
      <Button size="icon" onClick={onSend} disabled={disabled || !input.trim()}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </Button>
    </div>
  );
});

export default CoachInputBar;
