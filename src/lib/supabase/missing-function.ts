export function isMissingSupabaseFunction(error: { code?: string; message?: string } | null | undefined, name: string) {
  return error?.code === "PGRST202"
    || (error?.code === "42883" && String(error.message || "").includes(name));
}
