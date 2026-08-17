import { NextResponse } from "next/server";

export function apiError(error: unknown, fallback: string, status = 500) {
  const message = error instanceof Error ? error.message : fallback;

  if (message === "Sign in required.") {
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
  }

  if (message === "Admin access required.") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }

  if (message === "Active sales agent access required.") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }

  if (message === "Profile approval required before posting shifts.") {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }

  if (
    message === "An active venue account is required."
    || message === "Your venue team role does not allow this action."
  ) {
    return NextResponse.json({ ok: false, error: message }, { status: 403 });
  }

  return NextResponse.json({ ok: false, error: message }, { status });
}
