"use client";

import { useEffect, useState } from "react";
import type { AnalyticsBreakdownDTO, OverviewMetricsDTO, LearningInsightsDTO, InsightBucketDTO } from "@recoveros/shared";
import { apiFetch } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { HeroStat } from "@/components/ui/HeroStat";
import { RecoveredTrendChart } from "@/components/charts/RecoveredTrendChart";
import { PriorityBarChart } from "@/components/charts/PriorityBarChart";

export default function AnalyticsPage() {
  const [breakdown, setBreakdown] = useState<AnalyticsBreakdownDTO | null>(null);
  const [metrics, setMetrics] = useState<OverviewMetricsDTO | null>(null);
  const [insights, setInsights] = useState<LearningInsightsDTO | null>(null);

  useEffect(() => {
    apiFetch<AnalyticsBreakdownDTO>("/analytics/breakdown").then(setBreakdown);
    apiFetch<OverviewMetricsDTO>("/analytics/overview").then(setMetrics);
    apiFetch<LearningInsightsDTO>("/analytics/insights").then(setInsights);
  }, []);

  if (!breakdown || !metrics) {
    return <div className="p-6 text-sm text-ink-muted">Loading...</div>;
  }

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold">Analytics</h1>
      <p className="mb-6 text-sm text-ink-muted">How recovery is trending.</p>

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <HeroStat
          fill="white"
          label="Recovered (14d)"
          value={`${breakdown.recoveredByDay.reduce((s, d) => s + d.amount, 0)}`}
        />
        <HeroStat fill="dark" label="Open cases" value={String(metrics.openCases)} valueClassName="text-ink" />
        <HeroStat fill="dark" label="Recovery rate" value={`${metrics.recoveryRatePct}%`} valueClassName="text-ink" />
        <HeroStat
          fill="blue"
          label="High priority"
          value={String(breakdown.byPriority.find((p) => p.priority === "HIGH")?.count ?? 0)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Recovered amount, last 14 days</div>
          {breakdown.recoveredByDay.length === 0 ? (
            <div className="py-8 text-center text-xs text-ink-muted">No recoveries yet in this window.</div>
          ) : (
            <RecoveredTrendChart data={breakdown.recoveredByDay} />
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Amount at risk by priority</div>
          <PriorityBarChart data={breakdown.byPriority} />
        </Card>
      </div>

      <Card className="mt-4 p-4">
        <div className="mb-3 text-sm font-medium">Cases by status</div>
        <div className="flex flex-wrap gap-2">
          {breakdown.byStatus.map((s) => (
            <div
              key={s.status}
              className="rounded-full border border-surface-border px-3 py-1.5 text-xs text-ink-muted"
            >
              <span className="font-mono tabular text-ink">{s.count}</span> {s.status.replace(/_/g, " ")}
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-6">
        <div className="mb-1 text-sm font-medium">What we&apos;ve learned</div>
        <p className="mb-3 text-xs text-ink-muted">
          Real historical success rate, computed from every resolved case. investigatorAgent and
          decisionAgent read these same numbers before proposing anything.
        </p>
        {!insights ? (
          <div className="text-xs text-ink-muted">Loading...</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <InsightCard title="By diagnosed cause" buckets={insights.byCause} />
            <InsightCard title="By recommended action" buckets={insights.byAction} />
            <InsightCard title="By priority" buckets={insights.byPriority} />
          </div>
        )}
      </div>
    </div>
  );
}

function InsightCard({ title, buckets }: { title: string; buckets: InsightBucketDTO[] }) {
  return (
    <Card className="p-4">
      <div className="mb-3 text-sm font-medium">{title}</div>
      {buckets.length === 0 ? (
        <div className="text-xs text-ink-muted">Not enough resolved cases yet.</div>
      ) : (
        <div className="space-y-3">
          {buckets.map((b) => (
            <div key={b.key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="truncate text-ink-muted">{b.key.replace(/_/g, " ")}</span>
                <span className="font-mono tabular text-ink">
                  {b.successRatePct}% <span className="text-ink-faint">({b.recovered}/{b.attempts})</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised">
                <div
                  className="h-full rounded-full bg-signal-recovered"
                  style={{ width: `${b.successRatePct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
