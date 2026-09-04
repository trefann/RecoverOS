"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AuditLogEntryDTO, AuditLogListDTO } from "@recoveros/shared";
import { apiFetch } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { HeroStat } from "@/components/ui/HeroStat";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/format";

const ACTOR_TONE: Record<string, "ai" | "neutral"> = {
  investigatorAgent: "ai",
  decisionAgent: "ai",
  recoverabilityEngine: "neutral",
  policyEngine: "neutral",
  actionEngine: "neutral",
  verifier: "neutral",
  scheduler: "neutral",
  operator: "neutral",
};

const ACTOR_LABEL: Record<string, string> = {
  recoverabilityEngine: "Recoverability Engine",
  investigatorAgent: "Investigator (AI)",
  decisionAgent: "Decision Agent (AI)",
  policyEngine: "Policy Engine",
  actionEngine: "Action Engine",
  verifier: "Verifier",
  scheduler: "Scheduler",
  operator: "Operator",
};

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditLogEntryDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    apiFetch<AuditLogListDTO>("/analytics/audit").then((r) => {
      setEntries(r.entries);
      setNextCursor(r.nextCursor);
    });
  }, []);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const r = await apiFetch<AuditLogListDTO>(`/analytics/audit?cursor=${nextCursor}`);
      setEntries((prev) => [...prev, ...r.entries]);
      setNextCursor(r.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  const aiCount = entries.filter((e) => e.actor === "investigatorAgent" || e.actor === "decisionAgent").length;
  const deterministicCount = entries.length - aiCount;

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold">AI Activity / Audit</h1>
      <p className="mb-4 text-sm text-ink-muted">
        Every deterministic and AI decision, in order. The AI only ever proposes — every row below shows
        which layer actually acted.
      </p>

      <div className="mb-6 grid grid-cols-2 gap-4">
        <HeroStat fill="blue" label="AI proposals" value={String(aiCount)} sublabel="loaded so far" />
        <HeroStat fill="dark" label="Deterministic actions" value={String(deterministicCount)} valueClassName="text-ink" sublabel="loaded so far" />
      </div>

      <Card>
        <div className="divide-y divide-surface-border">
          {entries.length === 0 ? (
            <div className="px-4 py-6 text-sm text-ink-muted">No activity yet.</div>
          ) : (
            entries.map((e) => (
              <Link
                key={e.id}
                href={`/cases/${e.caseId}`}
                className="flex items-start justify-between gap-4 px-4 py-3 text-sm hover:bg-surface-raised/40"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Badge tone={ACTOR_TONE[e.actor] ?? "neutral"}>{ACTOR_LABEL[e.actor] ?? e.actor}</Badge>
                  <span className="truncate text-ink-muted">{e.summary}</span>
                </div>
                <span className="shrink-0 text-xs text-ink-faint">{formatDateTime(e.createdAt)}</span>
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
