"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { RecoveryCaseDTO, CaseListDTO } from "@recoveros/shared";
import { CASE_PRIORITIES } from "@recoveros/shared";
import { apiFetch } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { HeroStat } from "@/components/ui/HeroStat";
import { Badge, priorityTone, statusTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatMoney, formatCompactMoney, formatRelative } from "@/lib/format";
import clsx from "clsx";

const ACTION_LABELS: Record<string, string> = {
  RETRY_PAYMENT: "Retry recommended",
  SEND_REMINDER: "Reminder recommended",
  WAIT: "Wait recommended",
  ESCALATE_HUMAN: "Human escalation",
};

export default function QueuePage() {
  const [cases, setCases] = useState<RecoveryCaseDTO[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const qs = priorityFilter ? `?priority=${priorityFilter}` : "";
    apiFetch<CaseListDTO>(`/cases${qs}`).then((r) => {
      setCases(r.cases);
      setNextCursor(r.nextCursor);
    });
  }, [priorityFilter]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const qs = new URLSearchParams({ cursor: nextCursor, ...(priorityFilter ? { priority: priorityFilter } : {}) });
      const r = await apiFetch<CaseListDTO>(`/cases?${qs}`);
      setCases((prev) => [...prev, ...r.cases]);
      setNextCursor(r.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  const totalInQueue = cases.reduce((sum, c) => sum + c.amountAtRisk, 0);

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold">Recovery Queue</h1>
      <p className="mb-4 text-sm text-ink-muted">Every case still in motion.</p>

      <div className="mb-4">
        <HeroStat
          fill="blue"
          label="Total value in queue"
          value={formatCompactMoney(totalInQueue)}
          sublabel={`${cases.length} case${cases.length === 1 ? "" : "s"}`}
        />
      </div>

      <div className="mb-4 flex gap-1">
        <FilterChip active={priorityFilter === null} onClick={() => setPriorityFilter(null)}>
          All
        </FilterChip>
        {CASE_PRIORITIES.slice()
          .reverse()
          .map((p) => (
            <FilterChip key={p} active={priorityFilter === p} onClick={() => setPriorityFilter(p)}>
              {p}
            </FilterChip>
          ))}
      </div>

      <Card>
        <div className="divide-y divide-surface-border">
          {cases.length === 0 ? (
            <div className="px-4 py-6 text-sm text-ink-muted">No cases match this filter.</div>
          ) : (
            cases.map((c) => (
              <Link
                key={c.id}
                href={`/cases/${c.id}`}
                className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-4 px-4 py-4 text-sm hover:bg-surface-raised/40"
              >
                <span className="w-28 font-mono text-lg font-bold tabular">
                  {formatMoney(c.amountAtRisk, c.currency)}
                </span>
                <span className="truncate text-ink-muted">{c.reason ?? c.customerName}</span>
                <Badge tone={priorityTone(c.priority)}>{c.priority}</Badge>
                <span className="text-xs text-ink-muted">
                  {c.recommendedAction ? ACTION_LABELS[c.recommendedAction] : "Pending analysis"}
                </span>
                <div className="flex items-center gap-3">
                  <Badge tone={statusTone(c.status)}>{c.status.replace(/_/g, " ")}</Badge>
                  <span className="w-14 text-right text-xs text-ink-faint">{formatRelative(c.createdAt)}</span>
                </div>
              </Link>
            ))
          )}
        </div>
      </Card>

      {nextCursor ? (
        <div className="mt-4 flex justify-center">
          <Button
            className="bg-surface-raised text-ink hover:bg-surface-raised/70"
            disabled={loadingMore}
            onClick={loadMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "rounded-full border px-3 py-1.5 text-xs font-semibold",
        active
          ? "border-signal-ai/40 bg-signal-ai/10 text-signal-ai"
          : "border-surface-border text-ink-muted hover:bg-surface-raised"
      )}
    >
      {children}
    </button>
  );
}
