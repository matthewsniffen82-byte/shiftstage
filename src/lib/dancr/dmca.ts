import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTransactionalEmail } from "./notification-delivery";

type DancrClient = SupabaseClient;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MYDANCR_HOSTS = new Set(["mydancr.com", "www.mydancr.com"]);
const ACTIVE_ADMIN_STATUSES = ["submitted", "needs_information", "disabled", "countered", "court_hold"];

export class DmcaUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DmcaUserError";
  }
}

export type DmcaNoticeInput = {
  claimantName?: unknown;
  claimantCompany?: unknown;
  claimantEmail?: unknown;
  claimantPhone?: unknown;
  claimantAddress?: unknown;
  copyrightedWorkDescription?: unknown;
  originalWorkUrl?: unknown;
  infringingUrl?: unknown;
  goodFaithConfirmed?: unknown;
  accuracyConfirmed?: unknown;
  authorityConfirmed?: unknown;
  signature?: unknown;
  website?: unknown;
};

export type DmcaCounterInput = {
  legalName?: unknown;
  email?: unknown;
  phone?: unknown;
  address?: unknown;
  removedMaterialLocation?: unknown;
  mistakeBeliefConfirmed?: unknown;
  perjuryConfirmed?: unknown;
  jurisdictionConfirmed?: unknown;
  serviceConfirmed?: unknown;
  signature?: unknown;
};

export type DmcaAdminAction =
  | "request_information"
  | "reject"
  | "disable"
  | "record_court_action"
  | "restore"
  | "close";

export async function getPublicDmcaAgent(client: DancrClient) {
  const { data, error } = await (client as any)
    .from("dmca_agent_settings")
    .select(
      "legal_name, organization, email, phone, address_line_1, address_line_2, city, state_region, postal_code, country, registered_with_copyright_office, registration_renewal_at, updated_at",
    )
    .eq("id", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Copyright agent settings are unavailable.");
  return mapAgent(data);
}

export async function createDmcaNotice(
  client: DancrClient,
  input: DmcaNoticeInput,
  requestIp: string,
) {
  if (text(input.website, 200)) throw new DmcaUserError("Unable to submit copyright notice.");

  const claimantName = requiredText(input.claimantName, "Legal name", 2, 160);
  const claimantCompany = optionalText(input.claimantCompany, 160);
  const claimantEmail = validEmail(input.claimantEmail, "Claimant email");
  const claimantPhone = requiredText(input.claimantPhone, "Phone number", 7, 50);
  const claimantAddress = requiredText(input.claimantAddress, "Physical mailing address", 10, 1000);
  const copyrightedWorkDescription = requiredText(
    input.copyrightedWorkDescription,
    "Copyrighted work description",
    10,
    4000,
  );
  const originalWorkUrl = optionalHttpUrl(input.originalWorkUrl, "Original work URL");
  const infringingUrl = validMyDancrUrl(input.infringingUrl);
  const signature = requiredText(input.signature, "Electronic signature", 2, 160);

  requireConfirmation(input.goodFaithConfirmed, "Good-faith statement");
  requireConfirmation(input.accuracyConfirmed, "Accuracy and perjury statement");
  requireConfirmation(input.authorityConfirmed, "Authority statement");

  const requestIpHash = hashRequestIp(requestIp);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [ipRate, emailRate] = await Promise.all([
    (client as any)
      .from("dmca_cases")
      .select("id", { count: "exact", head: true })
      .eq("request_ip_hash", requestIpHash)
      .gte("created_at", oneHourAgo),
    (client as any)
      .from("dmca_cases")
      .select("id", { count: "exact", head: true })
      .eq("claimant_email", claimantEmail)
      .gte("created_at", oneDayAgo),
  ]);

  if (ipRate.error) throw ipRate.error;
  if (emailRate.error) throw emailRate.error;
  if ((ipRate.count || 0) >= 5 || (emailRate.count || 0) >= 3) {
    throw new DmcaUserError("Too many copyright notices were submitted. Try again later or email the copyright contact.");
  }

  const target = await resolveDmcaTarget(client, infringingUrl);
  const { data, error } = await (client as any)
    .from("dmca_cases")
    .insert({
      claimant_name: claimantName,
      claimant_company: claimantCompany,
      claimant_email: claimantEmail,
      claimant_phone: claimantPhone,
      claimant_address: claimantAddress,
      copyrighted_work_description: copyrightedWorkDescription,
      original_work_url: originalWorkUrl,
      infringing_url: infringingUrl,
      target_type: target.type,
      target_id: target.id,
      uploader_id: target.uploaderId,
      status: "submitted",
      good_faith_confirmed: true,
      accuracy_confirmed: true,
      authority_confirmed: true,
      signature,
      request_ip_hash: requestIpHash,
    })
    .select(
      "id, claimant_name, claimant_company, claimant_email, copyrighted_work_description, original_work_url, infringing_url, target_type, target_id, uploader_id, status, created_at",
    )
    .single();

  if (error) throw error;

  const confirmation = await sendTransactionalEmail({
    to: claimantEmail,
    subject: `MyDancr copyright notice ${data.id}`,
    text: [
      `We received your copyright notice ${data.id}.`,
      "",
      `Reported location: ${infringingUrl}`,
      "MyDancr will review the notice and may contact you if more information is required.",
      "Keep this case number for your records.",
    ].join("\n"),
  });

  return {
    ...mapCase(data),
    confirmationSent: confirmation.delivered,
  };
}

export async function getUploaderDmcaCase(client: DancrClient, userId: string, caseId: string) {
  requireUuid(caseId, "Invalid copyright case.");
  const { data, error } = await (client as any)
    .from("dmca_cases")
    .select(
      "id, claimant_name, claimant_company, claimant_email, copyrighted_work_description, original_work_url, infringing_url, target_type, target_id, uploader_id, status, disabled_at, counter_received_at, restore_eligible_at, restore_deadline_at, court_filing_received, restored_at, created_at, dmca_counter_notices(id, status, forwarded_to_claimant_at, created_at)",
    )
    .eq("id", caseId)
    .eq("uploader_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new DmcaUserError("Copyright case not found.");
  return mapCase(data);
}

export async function submitDmcaCounterNotice(
  client: DancrClient,
  userId: string,
  caseId: string,
  input: DmcaCounterInput,
) {
  requireUuid(caseId, "Invalid copyright case.");
  const legalName = requiredText(input.legalName, "Legal name", 2, 160);
  const email = validEmail(input.email, "Email");
  const phone = requiredText(input.phone, "Phone number", 7, 50);
  const address = requiredText(input.address, "Physical mailing address", 10, 1000);
  const removedMaterialLocation = requiredText(
    input.removedMaterialLocation,
    "Removed material location",
    8,
    2000,
  );
  const signature = requiredText(input.signature, "Electronic signature", 2, 160);

  requireConfirmation(input.mistakeBeliefConfirmed, "Mistake or misidentification statement");
  requireConfirmation(input.perjuryConfirmed, "Perjury statement");
  requireConfirmation(input.jurisdictionConfirmed, "Federal court jurisdiction consent");
  requireConfirmation(input.serviceConfirmed, "Service-of-process consent");

  const { data: dmcaCase, error: caseError } = await (client as any)
    .from("dmca_cases")
    .select("id, claimant_name, claimant_email, infringing_url, uploader_id, status, target_id")
    .eq("id", caseId)
    .eq("uploader_id", userId)
    .maybeSingle();

  if (caseError) throw caseError;
  if (!dmcaCase) throw new DmcaUserError("Copyright case not found.");
  if (dmcaCase.status !== "disabled") {
    throw new DmcaUserError("This copyright case is not eligible for a counter-notice.");
  }

  const counterReceivedAt = new Date();
  const restoreEligibleAt = addBusinessDays(counterReceivedAt, 10);
  const restoreDeadlineAt = addBusinessDays(counterReceivedAt, 14);
  const db = client as any;

  const { data: counter, error: counterError } = await db
    .from("dmca_counter_notices")
    .insert({
      case_id: caseId,
      uploader_id: userId,
      legal_name: legalName,
      email,
      phone,
      address,
      removed_material_location: removedMaterialLocation,
      mistake_belief_confirmed: true,
      perjury_confirmed: true,
      jurisdiction_confirmed: true,
      service_confirmed: true,
      signature,
      status: "submitted",
    })
    .select("id, case_id, status, created_at")
    .single();

  if (counterError) {
    if (String(counterError.code) === "23505") throw new DmcaUserError("A counter-notice was already submitted for this case.");
    throw counterError;
  }

  const { data: updatedCase, error: updateError } = await db
    .from("dmca_cases")
    .update({
      status: "countered",
      counter_received_at: counterReceivedAt.toISOString(),
      restore_eligible_at: restoreEligibleAt.toISOString(),
      restore_deadline_at: restoreDeadlineAt.toISOString(),
      updated_at: counterReceivedAt.toISOString(),
    })
    .eq("id", caseId)
    .eq("uploader_id", userId)
    .eq("status", "disabled")
    .select("id")
    .maybeSingle();

  if (updateError || !updatedCase) {
    const { error: rollbackError } = await db
      .from("dmca_counter_notices")
      .delete()
      .eq("id", counter.id)
      .eq("uploader_id", userId);
    if (rollbackError) {
      console.error("Unable to roll back an uncommitted DMCA counter-notice", {
        caseId,
        counterNoticeId: counter.id,
        rollbackError,
      });
    }
    if (updateError) throw updateError;
    throw new DmcaUserError("This copyright case is no longer eligible for a counter-notice.");
  }

  const forwarded = await sendTransactionalEmail({
    to: dmcaCase.claimant_email,
    subject: `Counter-notice for MyDancr copyright case ${caseId}`,
    text: counterNoticeEmail({
      caseId,
      claimantName: dmcaCase.claimant_name,
      legalName,
      email,
      phone,
      address,
      removedMaterialLocation,
      signature,
      restoreEligibleAt,
      restoreDeadlineAt,
    }),
  });

  if (forwarded.delivered) {
    await db
      .from("dmca_counter_notices")
      .update({
        status: "forwarded",
        forwarded_to_claimant_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", counter.id);
  }

  await db.from("notifications").insert({
    recipient_id: userId,
    notification_type: "dmca_status",
    channel: "in_app",
    title: "Counter-notice submitted",
    body: "Your counter-notice was received. The content remains disabled during the required waiting period.",
    payload: {
      caseId,
      status: "countered",
      restoreEligibleAt: restoreEligibleAt.toISOString(),
    },
    sent_at: new Date().toISOString(),
  });

  return {
    id: counter.id,
    caseId,
    status: forwarded.delivered ? "forwarded" : "submitted",
    restoreEligibleAt: restoreEligibleAt.toISOString(),
    restoreDeadlineAt: restoreDeadlineAt.toISOString(),
  };
}

export async function getAdminDmcaState(client: DancrClient) {
  const [casesResult, agentResult] = await Promise.all([
    (client as any)
      .from("dmca_cases")
      .select(
        "id, claimant_name, claimant_company, claimant_email, claimant_phone, claimant_address, copyrighted_work_description, original_work_url, infringing_url, target_type, target_id, uploader_id, status, signature, reviewed_by, reviewed_at, disabled_at, counter_received_at, restore_eligible_at, restore_deadline_at, court_filing_received, court_filing_notes, restored_at, repeat_infringer_enforced, admin_notes, created_at, dmca_counter_notices(id, legal_name, email, phone, address, removed_material_location, status, forwarded_to_claimant_at, created_at), dmca_strikes(id, active, issued_at, rescinded_at)",
      )
      .in("status", ACTIVE_ADMIN_STATUSES)
      .order("created_at", { ascending: true })
      .limit(100),
    (client as any)
      .from("dmca_agent_settings")
      .select(
        "legal_name, organization, email, phone, address_line_1, address_line_2, city, state_region, postal_code, country, registered_with_copyright_office, registration_renewal_at, updated_at",
      )
      .eq("id", true)
      .maybeSingle(),
  ]);

  if (casesResult.error) throw casesResult.error;
  if (agentResult.error) throw agentResult.error;

  return {
    cases: (casesResult.data || []).map(mapCase),
    agent: agentResult.data ? mapAgent(agentResult.data) : null,
  };
}

export async function updateDmcaAgent(
  client: DancrClient,
  adminId: string,
  input: Record<string, unknown>,
) {
  const legalName = requiredText(input.legalName, "Agent legal name", 2, 160);
  const organization = optionalText(input.organization, 160);
  const email = validEmail(input.email, "Agent email");
  const phone = optionalText(input.phone, 50);
  const addressLine1 = optionalText(input.addressLine1, 300);
  const addressLine2 = optionalText(input.addressLine2, 300);
  const city = optionalText(input.city, 120);
  const stateRegion = optionalText(input.stateRegion, 120);
  const postalCode = optionalText(input.postalCode, 30);
  const country = optionalText(input.country, 120);
  const registered = input.registeredWithCopyrightOffice === true;
  const registrationRenewalAt = optionalDate(input.registrationRenewalAt);

  if (registered && (!phone || !addressLine1 || !city || !stateRegion || !postalCode || !country || !registrationRenewalAt)) {
    throw new DmcaUserError("Registered agent details require a phone, complete mailing address, country, and renewal date.");
  }

  const { data, error } = await (client as any)
    .from("dmca_agent_settings")
    .upsert({
      id: true,
      legal_name: legalName,
      organization,
      email,
      phone,
      address_line_1: addressLine1,
      address_line_2: addressLine2,
      city,
      state_region: stateRegion,
      postal_code: postalCode,
      country,
      registered_with_copyright_office: registered,
      registration_renewal_at: registrationRenewalAt,
      updated_by: adminId,
      updated_at: new Date().toISOString(),
    })
    .select(
      "legal_name, organization, email, phone, address_line_1, address_line_2, city, state_region, postal_code, country, registered_with_copyright_office, registration_renewal_at, updated_at",
    )
    .single();

  if (error) throw error;

  await logDmcaAdminAction(client, adminId, null, "update_dmca_agent", registered ? "Registered agent details updated." : "Copyright contact details updated.");
  return mapAgent(data);
}

export async function applyDmcaAdminAction(
  client: DancrClient,
  adminId: string,
  caseId: string,
  action: DmcaAdminAction,
  notes?: string,
) {
  requireUuid(caseId, "Invalid copyright case.");
  const cleanNotes = optionalText(notes, 4000);
  const db = client as any;
  const { data: dmcaCase, error: caseError } = await db
    .from("dmca_cases")
    .select("id, claimant_name, claimant_email, uploader_id, status, target_id, restore_eligible_at")
    .eq("id", caseId)
    .maybeSingle();

  if (caseError) throw caseError;
  if (!dmcaCase) throw new DmcaUserError("Copyright case not found.");

  if (action === "disable") {
    const { data, error } = await db.rpc("apply_dmca_takedown", {
      p_case_id: caseId,
      p_admin_id: adminId,
      p_admin_notes: cleanNotes,
    });
    if (error) throw error;

    if (data?.uploaderId) {
      const { data: uploader, error: uploaderError } = await db
        .from("app_users")
        .select("email")
        .eq("id", data.uploaderId)
        .maybeSingle();
      if (uploaderError) {
        console.error("Unable to load the DMCA uploader email", {
          caseId,
          uploaderId: data.uploaderId,
          uploaderError,
        });
      } else if (uploader?.email) {
        const counterUrl = `${publicSiteUrl()}/dmca/counter/${encodeURIComponent(caseId)}`;
        await sendTransactionalEmail({
          to: uploader.email,
          subject: `MyDancr copyright notice ${caseId}`,
          text: [
            "A MyDancr TV video was disabled after a validated copyright notice.",
            "",
            `Review the case and, if appropriate, submit a legally complete counter-notice: ${counterUrl}`,
            data.repeatInfringerEnforced
              ? "Your account was also suspended after reaching three active copyright strikes."
              : "",
          ].filter(Boolean).join("\n"),
        });
      }
    }

    await sendTransactionalEmail({
      to: dmcaCase.claimant_email,
      subject: `MyDancr copyright notice ${caseId} processed`,
      text: `The material identified in copyright notice ${caseId} has been disabled. The uploader may submit a counter-notice as permitted by law.`,
    });
    return { caseId, status: "disabled", ...data };
  }

  if (action === "restore") {
    const { data, error } = await db.rpc("restore_dmca_case", {
      p_case_id: caseId,
      p_admin_id: adminId,
      p_restoration_notes: cleanNotes,
    });
    if (error) throw error;
    await notifyClaimantOfRestoration(dmcaCase.claimant_email, caseId);
    return { caseId, status: "restored", ...data };
  }

  const nextStatus =
    action === "request_information"
      ? "needs_information"
      : action === "reject"
        ? "rejected"
        : action === "record_court_action"
          ? "court_hold"
          : "closed";

  const update: Record<string, unknown> = {
    status: nextStatus,
    reviewed_by: adminId,
    reviewed_at: new Date().toISOString(),
    admin_notes: cleanNotes,
    updated_at: new Date().toISOString(),
  };
  if (action === "record_court_action") {
    if (dmcaCase.status !== "countered") throw new DmcaUserError("Only a countered notice can be placed on court hold.");
    if (!cleanNotes) throw new DmcaUserError("Record the court filing details before placing the case on hold.");
    update.court_filing_received = true;
    update.court_filing_notes = cleanNotes;
  }

  const { data, error } = await db
    .from("dmca_cases")
    .update(update)
    .eq("id", caseId)
    .select("id, status, updated_at")
    .single();
  if (error) throw error;

  await logDmcaAdminAction(client, adminId, caseId, `dmca_${action}`, cleanNotes);

  if (action === "request_information") {
    await sendTransactionalEmail({
      to: dmcaCase.claimant_email,
      subject: `More information needed for MyDancr copyright notice ${caseId}`,
      text: `MyDancr needs more information before processing copyright notice ${caseId}.\n\n${cleanNotes || "Reply with the missing information and your case number."}`,
    });
  } else if (action === "reject") {
    await sendTransactionalEmail({
      to: dmcaCase.claimant_email,
      subject: `MyDancr copyright notice ${caseId} could not be processed`,
      text: `MyDancr could not process copyright notice ${caseId}.\n\n${cleanNotes || "The notice did not provide the information required for a valid claim."}`,
    });
  }

  return { caseId: data.id, status: data.status, updatedAt: data.updated_at };
}

export async function restoreEligibleDmcaCases(client: DancrClient, limit = 25) {
  const db = client as any;
  const now = new Date().toISOString();
  const { data: cases, error } = await db
    .from("dmca_cases")
    .select("id, claimant_email")
    .eq("status", "countered")
    .eq("court_filing_received", false)
    .lte("restore_eligible_at", now)
    .order("restore_eligible_at", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 100));

  if (error) throw error;

  const results: Array<{ caseId: string; restored: boolean; error?: string }> = [];
  for (const dmcaCase of cases || []) {
    try {
      const { error: restoreError } = await db.rpc("restore_dmca_case", {
        p_case_id: dmcaCase.id,
        p_admin_id: null,
        p_restoration_notes: "Automatically restored after the statutory waiting period.",
      });
      if (restoreError) throw restoreError;
      await notifyClaimantOfRestoration(dmcaCase.claimant_email, dmcaCase.id);
      results.push({ caseId: dmcaCase.id, restored: true });
    } catch (error) {
      console.error("DMCA automatic restoration failed", { caseId: dmcaCase.id, error });
      results.push({
        caseId: dmcaCase.id,
        restored: false,
        error: error instanceof Error ? error.message : "Restoration failed.",
      });
    }
  }
  return results;
}

export async function forwardPendingDmcaCounterNotices(client: DancrClient, limit = 25) {
  const db = client as any;
  const { data: counters, error } = await db
    .from("dmca_counter_notices")
    .select(
      "id, case_id, legal_name, email, phone, address, removed_material_location, signature, status, dmca_cases!inner(claimant_name, claimant_email, status, restore_eligible_at, restore_deadline_at)",
    )
    .eq("status", "submitted")
    .is("forwarded_to_claimant_at", null)
    .eq("dmca_cases.status", "countered")
    .order("created_at", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 100));

  if (error) throw error;

  const results: Array<{ counterNoticeId: string; forwarded: boolean }> = [];
  for (const counter of counters || []) {
    const dmcaCase = Array.isArray(counter.dmca_cases)
      ? counter.dmca_cases[0]
      : counter.dmca_cases;
    if (!dmcaCase?.claimant_email || !dmcaCase.restore_eligible_at || !dmcaCase.restore_deadline_at) {
      results.push({ counterNoticeId: counter.id, forwarded: false });
      continue;
    }

    const sent = await sendTransactionalEmail({
      to: dmcaCase.claimant_email,
      subject: `Counter-notice for MyDancr copyright case ${counter.case_id}`,
      text: counterNoticeEmail({
        caseId: counter.case_id,
        claimantName: dmcaCase.claimant_name,
        legalName: counter.legal_name,
        email: counter.email,
        phone: counter.phone,
        address: counter.address,
        removedMaterialLocation: counter.removed_material_location,
        signature: counter.signature,
        restoreEligibleAt: new Date(dmcaCase.restore_eligible_at),
        restoreDeadlineAt: new Date(dmcaCase.restore_deadline_at),
      }),
    });

    if (sent.delivered) {
      const forwardedAt = new Date().toISOString();
      const { error: updateError } = await db
        .from("dmca_counter_notices")
        .update({
          status: "forwarded",
          forwarded_to_claimant_at: forwardedAt,
          updated_at: forwardedAt,
        })
        .eq("id", counter.id)
        .eq("status", "submitted");
      if (updateError) throw updateError;
    }
    results.push({ counterNoticeId: counter.id, forwarded: sent.delivered });
  }
  return results;
}

function mapAgent(row: any) {
  return {
    legalName: row.legal_name,
    organization: row.organization,
    email: row.email,
    phone: row.phone,
    addressLine1: row.address_line_1,
    addressLine2: row.address_line_2,
    city: row.city,
    stateRegion: row.state_region,
    postalCode: row.postal_code,
    country: row.country,
    registeredWithCopyrightOffice: row.registered_with_copyright_office === true,
    registrationRenewalAt: row.registration_renewal_at,
    updatedAt: row.updated_at,
  };
}

function mapCase(row: any) {
  return {
    id: row.id,
    claimantName: row.claimant_name,
    claimantCompany: row.claimant_company,
    claimantEmail: row.claimant_email,
    claimantPhone: row.claimant_phone,
    claimantAddress: row.claimant_address,
    copyrightedWorkDescription: row.copyrighted_work_description,
    originalWorkUrl: row.original_work_url,
    infringingUrl: row.infringing_url,
    targetType: row.target_type,
    targetId: row.target_id,
    uploaderId: row.uploader_id,
    status: row.status,
    signature: row.signature,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    disabledAt: row.disabled_at,
    counterReceivedAt: row.counter_received_at,
    restoreEligibleAt: row.restore_eligible_at,
    restoreDeadlineAt: row.restore_deadline_at,
    courtFilingReceived: row.court_filing_received === true,
    courtFilingNotes: row.court_filing_notes,
    restoredAt: row.restored_at,
    repeatInfringerEnforced: row.repeat_infringer_enforced === true,
    adminNotes: row.admin_notes,
    createdAt: row.created_at,
    counterNotices: row.dmca_counter_notices || [],
    strikes: row.dmca_strikes || [],
  };
}

async function resolveDmcaTarget(client: DancrClient, infringingUrl: string) {
  const url = new URL(infringingUrl);
  const match = url.pathname.match(/^\/tv\/([0-9a-f-]{36})\/?$/i);
  if (!match || !UUID_PATTERN.test(match[1])) {
    return { type: "other", id: null, uploaderId: null };
  }

  const { data, error } = await (client as any)
    .from("mydancr_tv_videos")
    .select("id, submitted_by")
    .eq("id", match[1])
    .maybeSingle();
  if (error) throw error;
  if (!data) return { type: "other", id: null, uploaderId: null };
  return { type: "tv_video", id: data.id, uploaderId: data.submitted_by };
}

function validMyDancrUrl(value: unknown) {
  const parsed = parseHttpUrl(requiredText(value, "Infringing MyDancr URL", 8, 2000), "Infringing MyDancr URL");
  if (!MYDANCR_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new DmcaUserError("The reported URL must be on mydancr.com.");
  }
  parsed.hash = "";
  return parsed.toString();
}

function optionalHttpUrl(value: unknown, label: string) {
  const clean = optionalText(value, 2000);
  return clean ? parseHttpUrl(clean, label).toString() : null;
}

function parseHttpUrl(value: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DmcaUserError(`${label} must be a complete web address.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new DmcaUserError(`${label} must use http or https.`);
  }
  return parsed;
}

function requiredText(value: unknown, label: string, min: number, max: number) {
  const clean = text(value, max);
  if (clean.length < min) throw new DmcaUserError(`${label} must be at least ${min} characters.`);
  return clean;
}

function optionalText(value: unknown, max: number) {
  const clean = text(value, max);
  return clean || null;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validEmail(value: unknown, label: string) {
  const clean = requiredText(value, label, 5, 320).toLowerCase();
  if (!EMAIL_PATTERN.test(clean)) throw new DmcaUserError(`${label} is invalid.`);
  return clean;
}

function requireConfirmation(value: unknown, label: string) {
  if (value !== true) throw new DmcaUserError(`${label} must be confirmed.`);
}

function requireUuid(value: string, message: string) {
  if (!UUID_PATTERN.test(value)) throw new DmcaUserError(message);
}

function optionalDate(value: unknown) {
  const clean = text(value, 10);
  if (!clean) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || Number.isNaN(Date.parse(`${clean}T00:00:00Z`))) {
    throw new DmcaUserError("Registration renewal date is invalid.");
  }
  return clean;
}

function hashRequestIp(requestIp: string) {
  const salt = process.env.DMCA_RATE_LIMIT_SALT || process.env.CRON_SECRET || "mydancr-dmca-rate-limit";
  return createHash("sha256").update(`${salt}:${requestIp || "unknown"}`).digest("hex");
}

function addBusinessDays(date: Date, days: number) {
  const result = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const weekday = result.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return result;
}

function publicSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://www.mydancr.com").replace(/\/+$/, "");
}

function counterNoticeEmail(input: {
  caseId: string;
  claimantName: string;
  legalName: string;
  email: string;
  phone: string;
  address: string;
  removedMaterialLocation: string;
  signature: string;
  restoreEligibleAt: Date;
  restoreDeadlineAt: Date;
}) {
  return [
    `Hello ${input.claimantName},`,
    "",
    `MyDancr received a counter-notice for copyright case ${input.caseId}.`,
    "",
    `Counter-notice sender: ${input.legalName}`,
    `Email: ${input.email}`,
    `Phone: ${input.phone}`,
    `Address: ${input.address}`,
    `Removed material location: ${input.removedMaterialLocation}`,
    "",
    "The sender stated under penalty of perjury that the material was removed because of mistake or misidentification, consented to the appropriate United States Federal District Court jurisdiction, and agreed to accept service of process from you or your agent.",
    `Electronic signature: ${input.signature}`,
    "",
    `Absent notice that you filed a court action, restoration becomes eligible on ${input.restoreEligibleAt.toISOString()} and must occur no later than ${input.restoreDeadlineAt.toISOString()}.`,
    "Send any court filing notice to the MyDancr copyright contact and include the case number.",
  ].join("\n");
}

async function notifyClaimantOfRestoration(email: string, caseId: string) {
  await sendTransactionalEmail({
    to: email,
    subject: `MyDancr copyright case ${caseId} restored`,
    text: `The material in copyright case ${caseId} was restored after the counter-notice waiting period ended without MyDancr recording a timely court filing notice.`,
  });
}

async function logDmcaAdminAction(
  client: DancrClient,
  adminId: string,
  caseId: string | null,
  action: string,
  notes: string | null,
) {
  const { error } = await (client as any).from("admin_actions").insert({
    admin_id: adminId,
    target_type: "dmca_case",
    target_id: caseId,
    action,
    notes,
  });
  if (error) throw error;
}
