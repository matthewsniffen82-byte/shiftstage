import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { getVenueStatementRows, venueStatementCsv } from "@/src/lib/dancr/finance";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const account = await getAccountByUserId(client, user.id);
    if (!account || account.role !== "venue" || account.accountState !== "active") {
      return Response.json({ ok: false, error: "Active venue account required." }, { status: 403 });
    }
    const month = new URL(request.url).searchParams.get("month") || currentMonth();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return Response.json({ ok: false, error: "Month must use YYYY-MM format." }, { status: 400 });
    }
    const statement = await getVenueStatementRows(createAdminSupabaseClient(), user.id, month);
    return new Response(venueStatementCsv(statement), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="mydancr-${month}-club-statement.csv"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error, "Unable to export venue statement.");
  }
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}
