import { createClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { CLUB_DEAL_OFFER_PRESETS } from "../src/lib/dancr/club-deal-presets.ts";
import { clubDealTransportationTerms } from "../src/lib/dancr/club-deal-transportation.ts";

export function transportationDealFields(deal) {
  const preset = CLUB_DEAL_OFFER_PRESETS[0];
  // Retain venue rules while retiring the standard discount-only condition.
  const terms = String(deal.deal_terms || "").replace("Discount applies to the standard general-admission cover only. ", "");
  return { deal_title: preset.title, deal_description: preset.description,
    deal_terms: clubDealTransportationTerms(terms || preset.terms) };
}

async function run() {
  const apply = process.argv.includes("--apply");
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: deals, error } = await client.from("club_deals")
    .select("id, venue_id, deal_title, deal_description, deal_terms, offer_type, booking_url, updated_at")
    .eq("is_active", true).is("removed_at", null).order("id");
  if (error) throw new Error("Could not read the active deal catalog.");
  const changed = deals.filter(deal => Object.entries(transportationDealFields(deal)).some(([key, value]) => deal[key] !== value));
  if (!apply) { console.log(JSON.stringify({ activeDeals: deals.length, changes: changed.length })); return; }
  const backup = process.argv[process.argv.indexOf("--backup") + 1];
  if (!process.argv.includes("--backup") || !backup) throw new Error("Provide --backup with a new local audit file path.");
  await writeFile(backup, JSON.stringify(changed, null, 2), { flag: "wx" });
  for (const deal of changed) {
    // Preserve the terms promised on any still-valid historical issued pass.
    let offset = 0;
    for (;;) {
      const { data: passes, error: passError } = await client.from("qr_redemptions")
        .select("id, audit").eq("club_deal_id", deal.id).eq("status", "generated")
        .gt("expires_at", new Date().toISOString()).order("id").range(offset, offset + 499);
      if (passError) throw new Error("Could not inspect historical deal passes.");
      for (const pass of passes) {
        if (pass.audit?.deal_snapshot) continue;
        const { error: snapshotError } = await client.from("qr_redemptions")
          .update({ audit: { ...pass.audit, deal_snapshot: { dealTitle: deal.deal_title,
            dealDescription: deal.deal_description, dealTerms: deal.deal_terms,
            offerType: deal.offer_type, bookingUrl: deal.booking_url } } })
          .eq("id", pass.id).eq("status", "generated");
        if (snapshotError) throw new Error("Could not retain the original pass terms.");
      }
      if (passes.length < 500) break;
      offset += passes.length;
    }
    const { data: updated, error: updateError } = await client.from("club_deals")
      .update({ ...transportationDealFields(deal), updated_at: new Date().toISOString() })
      .eq("id", deal.id).eq("venue_id", deal.venue_id).eq("updated_at", deal.updated_at)
      .eq("is_active", true).is("removed_at", null).select("id");
    if (updateError || updated?.length !== 1) throw new Error("Deal update failed or the catalog changed. Inspect before retrying.");
  }
  console.log(JSON.stringify({ updated: changed.length, backupSaved: true }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await run();
}
