export const VISIBILITY_OPTIONS = [
  { value: "internal", label: "Internal only", description: "Visible inside the club and to this club’s invited VIP guests; hidden from public discovery." },
  { value: "external", label: "External only", description: "Your full public MyDancr profile. You will not appear on the internal roster." },
  { value: "both", label: "Both", description: "Appear on the internal roster and external MyDancr. Your full profile is available from either." },
] as const;

export type VisibilityMode = typeof VISIBILITY_OPTIONS[number]["value"];

export function isVisibilityMode(value: unknown): value is VisibilityMode {
  return value === "internal" || value === "external" || value === "both";
}
