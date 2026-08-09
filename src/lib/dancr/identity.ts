import { deliverNotificationRows } from "./notification-delivery";
import {
  createVerifyMyContentVerification,
  getVerifyMyContentVerification,
  type VerifyMyContentStatus,
  type VerifyMyContentVerification,
} from "../verifymycontent";

export const IDENTITY_PROVIDER = "verifymy_content";

export type IdentityVerificationStatus =
  | "not_started"
  | VerifyMyContentStatus;

type IdentityVerificationRecord = {
  dancer_id: string;
  user_id: string;
  provider: string;
  provider_session_id: string;
  status: IdentityVerificationStatus;
  last_error_code: string | null;
  verified_at: string | null;
  redacted_at: string | null;
  updated_at: string;
};

export type PublicIdentityVerification = {
  provider: typeof IDENTITY_PROVIDER;
  status: IdentityVerificationStatus;
  lastErrorCode: string | null;
  verifiedAt: string | null;
  redactedAt: string | null;
  updatedAt: string | null;
};

export async function getOwnIdentityVerification(admin: any, userId: string): Promise<PublicIdentityVerification> {
  const { data: dancer, error: dancerError } = await admin
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (dancerError) throw dancerError;
  if (!dancer) throw new Error("Dancer profile not found.");

  const record = await getIdentityRecordByDancer(admin, dancer.id);
  if (record && (record.status === "pending" || record.status === "started")) {
    try {
      const remote = await getVerifyMyContentVerification(record.provider_session_id, userId);
      return await syncVerifyMyContentIdentityVerification(admin, remote);
    } catch (error) {
      console.warn("VERIFYMYCONTENT_STATUS_REFRESH_FAILED", {
        message: error instanceof Error ? error.message : "Unknown provider error.",
      });
    }
  }
  return toPublicIdentityVerification(record);
}

export async function startOwnIdentityVerification(
  admin: any,
  input: {
    userId: string;
    returnUrl: string;
    webhookUrl: string;
  },
) {
  const { data: account, error: accountError } = await admin
    .from("app_users")
    .select("id, account_state, email")
    .eq("id", input.userId)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account || account.account_state !== "active") {
    throw new Error("Reactivate your account before starting identity verification.");
  }
  const email = String(account.email || "").trim().toLowerCase();
  if (!email) throw new Error("Add an email address to your account before starting identity verification.");

  const { data: dancer, error: dancerError } = await admin
    .from("dancer_profiles")
    .select("id, disabled_at")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (dancerError) throw dancerError;
  if (!dancer) throw new Error("Dancer profile not found.");
  if (dancer.disabled_at) throw new Error("Reactivate your dancer profile before starting identity verification.");

  const existing = await getIdentityRecordByDancer(admin, dancer.id);
  if (existing?.status === "approved" && existing.verified_at) {
    return {
      verification: toPublicIdentityVerification(existing),
      redirectUrl: null,
      alreadyVerified: true,
    };
  }

  let remoteVerification: VerifyMyContentVerification | null = null;
  if (existing?.provider_session_id && (existing.status === "pending" || existing.status === "started")) {
    remoteVerification = await getVerifyMyContentVerification(existing.provider_session_id, input.userId);
    const synced = await syncVerifyMyContentIdentityVerification(admin, remoteVerification);
    if (synced.status === "approved") {
      return {
        verification: synced,
        redirectUrl: null,
        alreadyVerified: true,
      };
    }
  }

  if (!remoteVerification || remoteVerification.status === "expired" || remoteVerification.status === "failed") {
    remoteVerification = await createVerifyMyContentVerification({
      customerId: input.userId,
      email,
      returnUrl: input.returnUrl,
      webhookUrl: input.webhookUrl,
    });
  }

  const now = new Date().toISOString();
  const record = await saveIdentityRecord(admin, {
    dancer_id: dancer.id,
    user_id: input.userId,
    provider: IDENTITY_PROVIDER,
    provider_session_id: remoteVerification.id,
    status: remoteVerification.status,
    last_error_code: remoteVerification.reason,
    verified_at: null,
    redacted_at: null,
    updated_at: now,
  });

  const { error: profilePendingError } = await admin
    .from("dancer_profiles")
    .update({
      status: "pending_review",
      verification_status: "pending",
      approved_at: null,
      is_public: false,
      identity_provider: IDENTITY_PROVIDER,
      identity_verified_at: null,
    })
    .eq("id", dancer.id)
    .neq("status", "disabled");
  if (profilePendingError) throw profilePendingError;

  await purgeLegacyVerificationDocuments(admin, input.userId, dancer.id);

  return {
    verification: toPublicIdentityVerification(record),
    redirectUrl: remoteVerification.redirectUrl,
    alreadyVerified: false,
  };
}

export async function syncVerifyMyContentIdentityVerification(
  admin: any,
  verification: VerifyMyContentVerification,
) {
  const existingBySession = await getIdentityRecordBySession(admin, verification.id);
  if (!existingBySession) throw new Error("VerifyMyContent verification is not registered with MyDancr.");
  const dancerId = existingBySession.dancer_id;
  const userId = existingBySession.user_id;
  if (verification.customerId !== userId) {
    throw new Error("VerifyMyContent verification does not match its MyDancr account.");
  }

  const { data: dancer, error: dancerError } = await admin
    .from("dancer_profiles")
    .select("id, user_id, stage_name, status, disabled_at")
    .eq("id", dancerId)
    .eq("user_id", userId)
    .maybeSingle();
  if (dancerError) throw dancerError;
  if (!dancer) throw new Error("VerifyMyContent verification does not match a dancer profile.");

  const now = new Date().toISOString();
  const wasVerified = existingBySession.status === "approved" || Boolean(existingBySession.verified_at);
  const verificationSucceeded = verification.status === "approved";
  const nextStatus: IdentityVerificationStatus = wasVerified ? "approved" : verification.status;
  const verifiedAt = verificationSucceeded ? existingBySession.verified_at || now : existingBySession.verified_at;
  const record = await saveIdentityRecord(admin, {
    dancer_id: dancerId,
    user_id: userId,
    provider: IDENTITY_PROVIDER,
    provider_session_id: verification.id,
    status: nextStatus,
    last_error_code: verificationSucceeded ? null : verification.reason,
    verified_at: verifiedAt,
    redacted_at: existingBySession.redacted_at,
    updated_at: now,
  });

  if (verificationSucceeded) {
    const { data: account, error: accountError } = await admin
      .from("app_users")
      .select("account_state")
      .eq("id", userId)
      .maybeSingle();
    if (accountError) throw accountError;
    const accountActive =
      account?.account_state === "active" && !dancer.disabled_at && dancer.status !== "disabled";

    const { error: profileError } = await admin
      .from("dancer_profiles")
      .update({
        ...(accountActive ? { status: "pending_review" } : {}),
        is_public: false,
        verification_status: "approved",
        approved_at: null,
        identity_provider: IDENTITY_PROVIDER,
        identity_verified_at: verifiedAt,
      })
      .eq("id", dancerId);
    if (profileError) throw profileError;

    if (!wasVerified) {
      const notificationRow = {
        recipient_id: userId,
        notification_type: "approval_status" as const,
        channel: "in_app",
        title: accountActive
          ? "Identity verified — venue affiliation is next"
          : "Identity verified — reactivate to continue",
        body: accountActive
          ? `${String(dancer.stage_name || "Your MyDancr profile")} remains private until a venue manager scans your affiliation QR.`
          : `${String(dancer.stage_name || "Your MyDancr profile")} remains hidden while your account is disabled. Reactivate it to finish venue affiliation.`,
        payload: {
          dancerId,
          status: "approved",
          verificationProvider: IDENTITY_PROVIDER,
          verifiedAt,
        },
        sent_at: now,
      };
      const { error: notificationError } = await admin.from("notifications").insert(notificationRow);
      if (notificationError) throw notificationError;
      await deliverNotificationRows(admin, [notificationRow]);
    }
  } else if (!wasVerified) {
    const { error: profileError } = await admin
      .from("dancer_profiles")
      .update({
        status: "pending_review",
        verification_status: nextStatus === "expired" || nextStatus === "failed" ? "rejected" : "pending",
        approved_at: null,
        is_public: false,
        identity_provider: IDENTITY_PROVIDER,
        identity_verified_at: null,
      })
      .eq("id", dancerId)
      .neq("status", "disabled");
    if (profileError) throw profileError;
  }

  if (verificationSucceeded) {
    await purgeLegacyVerificationDocuments(admin, userId, dancerId);
  }

  return toPublicIdentityVerification(record);
}

async function getIdentityRecordByDancer(admin: any, dancerId: string): Promise<IdentityVerificationRecord | null> {
  const { data, error } = await admin
    .from("dancer_identity_verifications")
    .select(
      "dancer_id, user_id, provider, provider_session_id, status, last_error_code, verified_at, redacted_at, updated_at",
    )
    .eq("dancer_id", dancerId)
    .maybeSingle();
  if (error) throw error;
  return data as IdentityVerificationRecord | null;
}

async function getIdentityRecordBySession(admin: any, sessionId: string): Promise<IdentityVerificationRecord | null> {
  const { data, error } = await admin
    .from("dancer_identity_verifications")
    .select(
      "dancer_id, user_id, provider, provider_session_id, status, last_error_code, verified_at, redacted_at, updated_at",
    )
    .eq("provider_session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data as IdentityVerificationRecord | null;
}

async function saveIdentityRecord(
  admin: any,
  record: IdentityVerificationRecord,
): Promise<IdentityVerificationRecord> {
  const { data, error } = await admin
    .from("dancer_identity_verifications")
    .upsert(record, { onConflict: "dancer_id" })
    .select(
      "dancer_id, user_id, provider, provider_session_id, status, last_error_code, verified_at, redacted_at, updated_at",
    )
    .single();
  if (error) throw error;
  return data as IdentityVerificationRecord;
}

async function purgeLegacyVerificationDocuments(admin: any, userId: string, dancerId: string) {
  const prefix = `${userId}/verification`;
  const bucket = admin.storage.from("verification-documents");
  const { data, error } = await bucket.list(prefix, { limit: 1000 });
  if (error) {
    console.warn("LEGACY_IDENTITY_DOCUMENT_PURGE_LIST_FAILED", { code: error.code || null });
    return;
  }

  const paths = (data || []).filter((item: any) => item?.name).map((item: any) => `${prefix}/${item.name}`);
  if (paths.length) {
    const { error: removeError } = await bucket.remove(paths);
    if (removeError) {
      console.warn("LEGACY_IDENTITY_DOCUMENT_PURGE_FAILED", { code: removeError.code || null });
      return;
    }
  }

  const { error: reviewError } = await admin
    .from("approval_reviews")
    .delete()
    .eq("dancer_id", dancerId)
    .like("review_type", "verification_document:%");
  if (reviewError) {
    console.warn("LEGACY_IDENTITY_REVIEW_PURGE_FAILED", { code: reviewError.code || null });
  }
}

function toPublicIdentityVerification(
  record: IdentityVerificationRecord | null,
): PublicIdentityVerification {
  return {
    provider: IDENTITY_PROVIDER,
    status: record?.status || "not_started",
    lastErrorCode: record?.last_error_code || null,
    verifiedAt: record?.verified_at || null,
    redactedAt: record?.redacted_at || null,
    updatedAt: record?.updated_at || null,
  };
}
