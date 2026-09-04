import clsx from "clsx";
import { Card } from "./Card";

type Tone = "risk" | "recoverable" | "recovered" | "neutral";

const VALUE_TONE: Record<Tone, string> = {
  risk: "text-signal-risk",
  recoverable: "text-signal-recoverable",
  recovered: "text-signal-recovered",
  neutral: "text-ink",
};

export function StatTile({
  label,
  value,
  tone = "neutral",
  sublabel,
}: {
  label: string;
  value: string;
  tone?: Tone;
  sublabel?: string;
}) {
  return (
    <Card className="px-5 py-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={clsx("mt-2 font-mono text-3xl font-semibold tabular", VALUE_TONE[tone])}>{value}</div>
      {sublabel ? <div className="mt-1 text-xs text-ink-faint">{sublabel}</div> : null}
    </Card>
  );
}
