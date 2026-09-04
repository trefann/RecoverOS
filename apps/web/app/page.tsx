"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

const AUTO_ADVANCE_MS = 3200;
const LEAVE_TRANSITION_MS = 300;

export default function HomePage() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const showTimer = setTimeout(() => setVisible(true), 50);
    const advanceTimer = setTimeout(() => goToDashboard(), AUTO_ADVANCE_MS);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(advanceTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goToDashboard() {
    setLeaving(true);
    setTimeout(() => router.push("/overview"), LEAVE_TRANSITION_MS);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div
        className={`max-w-xl transition-all ease-out ${
          leaving
            ? "duration-300 -translate-y-3 opacity-0"
            : visible
              ? "translate-y-0 opacity-100 duration-700"
              : "translate-y-3 opacity-0 duration-700"
        }`}
      >
        <div className="font-mono text-5xl font-black tracking-tight md:text-6xl">RecoverOS</div>
        <p className="mt-5 text-base leading-relaxed text-ink-muted md:text-lg">
          Failed payments, abandoned checkouts, and overdue invoices don&apos;t have to become lost
          revenue. RecoverOS detects what&apos;s at risk, has AI investigate and propose a recovery
          action, and lets a deterministic policy engine decide what actually executes.
        </p>
        <div className="mt-9 flex justify-center">
          <Button onClick={goToDashboard}>Enter Dashboard →</Button>
        </div>
      </div>
    </main>
  );
}
