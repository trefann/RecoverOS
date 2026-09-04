import clsx from "clsx";

export type HeroFill = "blue" | "dark" | "white";

const FILL_CARD: Record<HeroFill, string> = {
  blue: "bg-signal-ai text-black",
  dark: "border border-surface-border bg-surface-panel",
  white: "bg-ink text-black",
};

const FILL_LABEL: Record<HeroFill, string> = {
  blue: "opacity-70",
  dark: "text-ink-muted",
  white: "opacity-60",
};

const FILL_VALUE: Record<HeroFill, string> = {
  blue: "",
  dark: "text-signal-ai",
  white: "",
};

const FILL_PILL: Record<HeroFill, string> = {
  blue: "bg-black/10",
  dark: "bg-white/10 text-ink-muted",
  white: "bg-black/10",
};

/**
 * Solid-fill "hero" stat block — the bold, chunky-number, heavily-rounded
 * card style (vs. the old thin-bordered StatTile). Only three fills exist on
 * purpose: blue/dark/white is the whole palette, so severity/emphasis reads
 * from which fill a stat gets, not from a wider color set.
 */
export function HeroStat({
  label,
  value,
  sublabel,
  fill = "dark",
  valueClassName,
}: {
  label: string;
  value: string;
  sublabel?: string;
  fill?: HeroFill;
  valueClassName?: string;
}) {
  return (
    <div className={clsx("rounded-[28px] p-6", FILL_CARD[fill])}>
      <div className={clsx("text-xs font-semibold uppercase tracking-wide", FILL_LABEL[fill])}>{label}</div>
      <div
        className={clsx(
          "mt-3 font-mono text-4xl font-black leading-none tabular md:text-5xl",
          valueClassName ?? FILL_VALUE[fill]
        )}
      >
        {value}
      </div>
      {sublabel ? (
        <div className={clsx("mt-4 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold", FILL_PILL[fill])}>
          {sublabel}
        </div>
      ) : null}
    </div>
  );
}
