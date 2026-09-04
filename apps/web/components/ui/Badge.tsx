import clsx from "clsx";
import type { ReactNode } from "react";

type Tone = "risk" | "recoverable" | "recovered" | "ai" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  risk: "bg-signal-risk/10 text-signal-risk border-signal-risk/30",
  recoverable: "bg-signal-recoverable/10 text-signal-recoverable border-signal-recoverable/30",
  recovered: "bg-signal-recovered/10 text-signal-recovered border-signal-recovered/30",
  ai: "bg-signal-ai/10 text-signal-ai border-signal-ai/30",
  neutral: "bg-surface-raised text-ink-muted border-surface-border",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
        TONE_CLASSES[tone]
      )}
    >
      {children}
    </span>
  );
}

export function priorityTone(priority: string): Tone {
  if (priority === "HIGH") return "risk";
  if (priority === "MEDIUM") return "recoverable";
  return "neutral";
}

export function statusTone(status: string): Tone {
  if (status === "RECOVERED") return "recovered";
  if (status === "ESCALATED" || status === "FAILED" || status === "POLICY_REJECTED") return "risk";
  if (status === "ACTION_SCHEDULED" || status === "ACTION_IN_PROGRESS") return "ai";
  return "neutral";
}
