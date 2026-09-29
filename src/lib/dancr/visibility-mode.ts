export const VISIBILITY_OPTIONS = [
  { value: "internal", label: "Internal only", description: "Appear on this club’s internal roster. Customers can tap your avatar to view your full profile. You stay out of external discovery." },
  { value: "external", label: "External only", description: "Your full public MyDancr profile. You will not appear on the internal roster." },
  { value: "both", label: "Both", description: "Appear on the internal roster and external MyDancr. Your full profile is available from either." },
] as const;

export type VisibilityMode = typeof VISIBILITY_OPTIONS[number]["value"];

export function isVisibilityMode(value: unknown): value is VisibilityMode {
  return value === "internal" || value === "external" || value === "both";
}
