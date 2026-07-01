import { readFile } from "node:fs/promises";
import path from "node:path";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const htmlPath = path.join(process.cwd(), "outputs", "index.html");
  const html = await readFile(htmlPath, "utf8");
  const callbackSession = await readCallbackSession(request);
  const sessionScript = callbackSession
    ? `<script>window.__DANCR_CONFIRMED_SESSION__=${JSON.stringify(callbackSession).replace(/</g, "\\u003c")};</script>`
    : "";
  const withBase = html.replace("<head>", `<head><base href="/outputs/">${sessionScript}`);

  return new Response(withBase, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function readCallbackSession(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const roleHint = readCallbackRole(url.searchParams.get("role"));
  if (!code) return null;

  try {
    const client = createServerSupabaseClient();
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error || !data.session || !data.user) return null;

    const admin = createAdminSupabaseClient();
    let account = await getAccountByUserId(admin, data.user.id);
    if (roleHint && account && account.role !== roleHint) {
      const { error: roleError } = await admin.from("app_users").update({ role: roleHint }).eq("id", data.user.id);
      if (!roleError) account = { ...account, role: roleHint };
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
      account,
    };
  } catch {
    return null;
  }
}

function readCallbackRole(value: string | null) {
  return value === "customer" || value === "dancer" || value === "venue" ? value : null;
}
