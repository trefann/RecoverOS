"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { CaseDetailDTO } from "@recoveros/shared";
import { apiFetch, ApiError } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { Badge, priorityTone, statusTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Timeline } from "@/components/case/Timeline";
import { formatMoney, formatDateTime } from "@/lib/format";
import clsx from "clsx";

const TERMINAL_STATUSES = new Set(["RECOVERED", "FAILED", "POLICY_REJECTED"]);

export default function CaseDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<CaseDetailDTO | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<"retry" | "escalate" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    return apiFetch<CaseDetailDTO>(`/cases/${params.id}`)
      .then(setDetail)
      .catch(() => setNotFound(true));
  }, [params.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function runAction(kind: "retry" | "escalate") {
    setBusy(kind);
    setActionError(null);
    try {
      await apiFetch(`/cases/${params.id}/${kind}`, { method: "POST" });
      await refresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  if (notFound) return <div className="p-6 text-sm text-ink-muted">Case not found.</div>;
  if (!detail) return <div className="p-6 text-sm text-ink-muted">Loading...</div>;

  const { case: c, actions, outcomes, timeline } = detail;
  const isTerminal = TERMINAL_STATUSES.has(c.status);

  const heroFill =
    c.status === "RECOVERED" ? "white" : c.status === "ESCALATED" || c.priority === "HIGH" ? "blue" : "dark";
  const heroText = heroFill === "dark" ? "text-ink" : "text-black";
  const heroMuted = heroFill === "dark" ? "text-ink-muted" : "text-black/60";
  const heroPill = heroFill === "dark" ? "bg-white/10 text-ink-muted" : "bg-black/10";

  return (
    <div className="p-6">
      <div className={clsx("mb-6 rounded-[28px] p-6", heroFill === "dark" ? "border border-surface-border bg-surface-panel" : heroFill === "white" ? "bg-ink" : "bg-signal-ai")}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className={clsx("font-mono text-4xl font-black leading-none tabular md:text-5xl", heroText)}>
              {formatMoney(c.amountAtRisk, c.currency)}
            </div>
            <div className={clsx("mt-3 text-sm", heroMuted)}>
              {c.customerName} · {c.sourceType.toLowerCase()} · opened {formatDateTime(c.createdAt)}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <span className={clsx("inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide", heroPill)}>
                {c.priority}
              </span>
              <span className={clsx("inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide", heroPill)}>
                {c.status.replace(/_/g, " ")}
              </span>
            </div>
          </div>

          {!isTerminal ? (
            <div className="flex items-center gap-2">
              <Button
                className="bg-white text-black hover:bg-white/90"
                disabled={busy !== null}
                onClick={() => runAction("retry")}
              >
                {busy === "retry" ? "Retrying…" : "Retry now"}
              </Button>
              {c.status !== "ESCALATED" ? (
                <Button className="bg-black text-white hover:bg-black/80" disabled={busy !== null} onClick={() => runAction("escalate")}>
                  {busy === "escalate" ? "Escalating…" : "Escalate"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <div className="mb-4 rounded-2xl border border-signal-risk/30 bg-signal-risk/10 px-3 py-2 text-xs text-signal-risk">
          {actionError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="p-5">
          <div className="mb-4 text-sm font-medium">Recovery timeline</div>
          <Timeline events={timeline} />
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 text-sm font-medium">Case scoring</div>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <ScoreChip label="Risk" value={c.riskScore} />
              <ScoreChip label="Recoverability" value={c.recoverabilityScore} />
            </div>
            <div className="border-t border-surface-border pt-3 text-xs text-ink-muted">
              {c.reason ?? "No reason recorded yet."}
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-3 text-sm font-medium">Actions</div>
            {actions.length === 0 ? (
              <div className="text-xs text-ink-muted">No actions taken yet.</div>
            ) : (
              <div className="space-y-2">
                {actions.map((a) => (
                  <div key={a.id} className="rounded-2xl border border-surface-border p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{a.actionType.replace(/_/g, " ")}</span>
                      <Badge tone={a.status === "COMPLETED" ? "recovered" : a.status === "FAILED" ? "risk" : "neutral"}>
                        {a.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-ink-muted">{a.reason}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {outcomes.length > 0 ? (
            <Card className="p-4">
              <div className="mb-3 text-sm font-medium">Outcomes</div>
              {outcomes.map((o) => (
                <div key={o.id} className="flex items-center justify-between text-sm">
                  <span className={o.success ? "text-signal-recovered" : "text-signal-risk"}>
                    {o.success ? "Recovered" : "Not recovered"}
                  </span>
                  <span className="font-mono tabular">{formatMoney(o.amountRecovered, c.currency)}</span>
                </div>
              ))}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ScoreChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-raised p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 font-mono text-xl font-black tabular text-signal-ai">{Math.round(value * 100)}%</div>
    </div>
  );
}
