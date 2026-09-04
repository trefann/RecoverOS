import type { CaseTimelineEventDTO } from "@recoveros/shared";
import { formatDateTime } from "@/lib/format";

export function Timeline({ events }: { events: CaseTimelineEventDTO[] }) {
  return (
    <ol className="space-y-0">
      {events.map((event, i) => (
        <li key={`${event.step}-${event.timestamp}-${i}`} className="relative flex gap-4 pb-6 last:pb-0">
          <div className="flex flex-col items-center">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-signal-ai" />
            {i < events.length - 1 ? <span className="mt-1 w-px flex-1 bg-surface-border" /> : null}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-ink">{event.label}</span>
              <span className="shrink-0 text-xs text-ink-faint">{formatDateTime(event.timestamp)}</span>
            </div>
            {event.detail ? <div className="mt-0.5 text-xs text-ink-muted">{event.detail}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
