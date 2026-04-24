import type { Tier } from "@/lib/db/universe";

const STYLES: Record<Tier, string> = {
  S: "bg-[#ef5350]/20 text-[#ef5350] border-[#ef5350]/40",
  A: "bg-[#26a69a]/20 text-[#26a69a] border-[#26a69a]/40",
  B: "bg-[#7aa2ff]/15 text-[#7aa2ff] border-[#7aa2ff]/30",
};

export default function TierBadge({
  tier,
  className = "",
}: {
  tier: Tier | null;
  className?: string;
}) {
  if (!tier) {
    return (
      <span
        className={`inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted ${className}`}
      >
        -
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold leading-none ${STYLES[tier]} ${className}`}
    >
      {tier}
    </span>
  );
}
