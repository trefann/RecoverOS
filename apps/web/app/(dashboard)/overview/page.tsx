"use client";

import { useEffect, useState } from "react";
import type { OverviewMetricsDTO, RecoveryCaseDTO, CaseListDTO } from "@recoveros/shared";
import { apiFetch } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { HeroStat } from "@/components/ui/HeroStat";
import { Badge, priorityTone, statusTone } from "@/components/ui/Badge";
import { formatCompactMoney, formatRelative } from "@/lib/format";
import Link from "next/link";

export default function OverviewPage() {
  const [metrics, setMetrics] = useState<OverviewMetricsDTO | null>(null);
  const [recent, setRecent] = useState<RecoveryCaseDTO[]>([]);

  useEffect(() => {
    apiFetch<OverviewMetricsDTO>("/analytics/overview").then(setMetrics);
    apiFetch<CaseListDTO>("/cases").then((r) => setRecent(r.cases.slice(0, 6)));
  }, []);

  if (!metrics) {
    return <div className="p-6 text-sm text-ink-muted">Loading...</div>;
  }

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold">Overview</h1>
      <p className="mb-6 text-sm text-ink-muted">Revenue recovery, at a glance.</p>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <HeroStat
          fill="blue"
          label="Revenue at Risk"
          value={formatCompactMoney(metrics.revenueAtRisk, metrics.currency)}
          sublabel={`${metrics.openCases} open cases`}
        />
        <HeroStat
          fill="dark"
          label="Recoverable"
          value={formatCompactMoney(metrics.recoverable, metrics.currency)}
          sublabel="Probability-weighted"
        />
        <HeroStat
          fill="white"
          label="Recovered"
          value={formatCompactMoney(metrics.recovered, metrics.currency)}
          sublabel="All time"
        />
        <HeroStat
          fill="dark"
          label="Recovery Rate"
          value={`${metrics.recoveryRatePct}%`}
          sublabel="Of resolved cases"
          valueClassName="text-ink"
        />
      </div>

      <Card className="mt-6">
        <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
          <div className="text-sm font-medium">Recent cases</div>
          <Link href="/queue" className="text-xs text-signal-ai hover:underline">
            View queue →
          </Link>
        </div>
        <div className="divide-y divide-surface-border">
          {recent.length === 0 ? (
            <div className="px-4 py-6 text-sm text-ink-muted">No cases yet. Trigger the demo webhook to see one appear here.</div>
          ) : (
            recent.map((c) => (
              <Link
                key={c.id}
                href={`/cases/${c.id}`}
                className="flex items-center justify-between px-4 py-3 text-sm hover:bg-surface-raised/40"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono tabular">{formatCompactMoney(c.amountAtRisk, c.currency)}</span>
                  <span className="text-ink-muted">{c.customerName}</span>
                  <Badge tone={priorityTone(c.priority)}>{c.priority}</Badge>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={statusTone(c.status)}>{c.status.replace(/_/g, " ")}</Badge>
                  <span className="text-xs text-ink-faint">{formatRelative(c.createdAt)}</span>
                </div>
              </Link>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
