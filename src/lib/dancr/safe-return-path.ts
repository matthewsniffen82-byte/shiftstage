const LOCAL_RETURN_BASE = "https://return.mydancr.invalid";
const ENCODED_AUTHORITY_SEPARATOR = /^\/%(?:2f|5c)/i;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export function safeLocalReturnPath(value: unknown) {
  const requested = typeof value === "string" ? value.trim() : "";
  if (
    !requested.startsWith("/")
    || requested.startsWith("//")
    || requested.includes("\\")
    || ENCODED_AUTHORITY_SEPARATOR.test(requested)
    || CONTROL_CHARACTER.test(requested)
  ) {
    return "";
  }

  try {
    const base = new URL(LOCAL_RETURN_BASE);
    const destination = new URL(requested, base);
    if (destination.origin !== base.origin) return "";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "";
  }
}
