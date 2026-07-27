import { createHmac } from "node:crypto";
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "../env";
import {
  addAutomatedSupportReply,
  escalateSupportThread,
  recordSupportAiRun,
} from "./support";
import type { UserRole } from "./types";

type DancrClient = SupabaseClient;

type SupportMessage = {
  id: string;
  senderRole: UserRole;
  senderKind?: "human" | "ai" | "system";
  body: string;
  createdAt: string;
};

type SupportThread = {
  id: string;
  subject: string;
  escalationStatus?: string;
  aiReplyCount?: number;
  messages: SupportMessage[];
};

type EscalationPriority = "low" | "normal" | "high" | "urgent";

type SupportDecision = {
  reply: string;
  shouldEscalate: boolean;
  escalationCategory: string;
  escalationPriority: EscalationPriority;
  escalationReason: string;
  confidence: number;
};

type DeterministicEscalation = {
  category: string;
  priority: EscalationPriority;
  reason: string;
};

const SUPPORT_MODEL = process.env.OPENAI_SUPPORT_MODEL || "gpt-5.6-luna";
const SUPPORT_MAX_HISTORY_MESSAGES = 16;
const SUPPORT_MAX_AUTOMATED_REPLIES = 4;
const SUPPORT_CONFIDENCE_THRESHOLD = 0.72;

const SUPPORT_DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string", minLength: 1, maxLength: 2400 },
    shouldEscalate: { type: "boolean" },
    escalationCategory: {
      type: "string",
      enum: ["none", "human_requested", "billing", "account_access", "identity_verification", "moderation_appeal", "privacy_legal", "safety", "harassment_abuse", "technical_issue", "low_confidence", "other"],
    },
    escalationPriority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
    escalationReason: { type: "string", maxLength: 1000 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "reply",
    "shouldEscalate",
    "escalationCategory",
    "escalationPriority",
    "escalationReason",
    "confidence",
  ],
} as const;

const SUPPORT_INSTRUCTIONS = `You are Dancr Support AI for authenticated customer, dancer, and venue accounts.

Answer routine product-use questions directly, using only the supplied account context and conversation. Do not invent account facts, counts, policies, dates, payments, approvals, venue data, or actions. You cannot modify accounts, issue refunds, approve profiles, change billing, delete data, or contact third parties.

Escalate when the user requests a human; asks about charges, refunds, subscriptions, payouts, fraud, or chargebacks; cannot access an account; disputes identity or verification; appeals moderation or approval; requests deletion, privacy, legal, or law-enforcement action; reports threats, coercion, trafficking, minors, harassment, abuse, stalking, self-harm, violence, or immediate danger; reports a security vulnerability; needs an admin-only change; repeats that prior steps failed; or when confidence is below 0.72.

For immediate danger, tell the user to contact local emergency services and move to a safe place if possible. Do not provide a phone number. Never promise a response time.

State the answer directly. Acknowledge the specific problem. Give no more than four short steps. If escalating, clearly say a human support specialist will review the same chat and why. Never claim escalation unless shouldEscalate is true.`;

export async function processAutomatedSupportMessage(client: DancrClient, input: {
  userId: string;
  role: Exclude<UserRole, "admin">;
  thread: SupportThread;
}) {
  if (input.thread.escalationStatus === "escalated") return;

  const latestUserMessage = [...input.thread.messages]
    .reverse()
    .find((message) => message.senderKind !== "ai" && message.senderRole !== "admin");
  if (!latestUserMessage) throw new Error("Support message not found.");

  const deterministic = deterministicEscalationFor(
    latestUserMessage.body,
    Number(input.thread.aiReplyCount || 0),
  );
  const openai = new OpenAI({ apiKey: getServerEnv("OPENAI_API_KEY") });
  let moderation: Record<string, unknown> = {};

  try {
    moderation = await moderateSupportText(openai, latestUserMessage.body);
    const moderationEscalation = moderation.flagged
      ? {
          category: "safety",
          priority: "urgent" as const,
          reason: "OpenAI moderation identified content requiring human safety review.",
        }
      : null;
    const requiredEscalation = highestPriorityEscalation(deterministic, moderationEscalation);

    if (requiredEscalation) {
      const acknowledgement = escalationAcknowledgement(requiredEscalation);
      const escalated = await escalateSupportThread(client, {
        threadId: input.thread.id,
        category: requiredEscalation.category,
        reason: requiredEscalation.reason,
        priority: requiredEscalation.priority,
        acknowledgement,
      });
      await recordSupportAiRun(client, {
        threadId: input.thread.id,
        triggerMessageId: latestUserMessage.id,
        responseMessageId: escalated.messageId,
        model: SUPPORT_MODEL,
        outcome: "escalated_by_rule",
        category: requiredEscalation.category,
        priority: requiredEscalation.priority,
        reason: requiredEscalation.reason,
        confidence: 1,
        moderation,
      });
      return;
    }

    const accountContext = await getSupportAccountContext(client, input.userId, input.role);
    const response = await (openai.responses as any).create({
      model: SUPPORT_MODEL,
      store: false,
      reasoning: { effort: "low" },
      safety_identifier: safetyIdentifier(input.userId),
      instructions: SUPPORT_INSTRUCTIONS,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                accountContext,
                subject: input.thread.subject,
                conversation: input.thread.messages
                  .slice(-SUPPORT_MAX_HISTORY_MESSAGES)
                  .map((message) => ({
                    speaker: message.senderKind === "ai" ? "Dancr Support AI" : message.senderRole,
                    body: message.body,
                  })),
              }),
            },
          ],
        },
      ],
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "dancr_support_decision",
          strict: true,
          schema: SUPPORT_DECISION_SCHEMA,
        },
      },
      max_output_tokens: 900,
    });

    const decision = parseSupportDecision(response.output_text);
    const confidenceEscalation = decision.confidence < SUPPORT_CONFIDENCE_THRESHOLD
      ? {
          category: "low_confidence",
          priority: "normal" as const,
          reason: `Automated support confidence was ${decision.confidence.toFixed(2)}.`,
        }
      : null;
    const modelEscalation = decision.shouldEscalate
      ? {
          category: decision.escalationCategory === "none" ? "other" : decision.escalationCategory,
          priority: decision.escalationPriority,
          reason: decision.escalationReason || "The support model determined that human review is required.",
        }
      : null;
    const escalation = highestPriorityEscalation(confidenceEscalation, modelEscalation);

    if (escalation) {
      const outputModeration = await moderateSupportText(openai, decision.reply);
      const acknowledgement = outputModeration.flagged
        ? escalationAcknowledgement(escalation)
        : normalizeReply(decision.reply);
      const escalated = await escalateSupportThread(client, {
        threadId: input.thread.id,
        category: escalation.category,
        reason: escalation.reason,
        priority: escalation.priority,
        acknowledgement,
        model: SUPPORT_MODEL,
        responseId: response.id,
        confidence: decision.confidence,
      });
      await recordSupportAiRun(client, {
        threadId: input.thread.id,
        triggerMessageId: latestUserMessage.id,
        responseMessageId: escalated.messageId,
        providerResponseId: response.id,
        model: SUPPORT_MODEL,
        outcome: "escalated_by_model",
        category: escalation.category,
        priority: escalation.priority,
        reason: escalation.reason,
        confidence: decision.confidence,
        moderation: { input: moderation, output: outputModeration },
      });
      return;
    }

    const outputModeration = await moderateSupportText(openai, decision.reply);
    if (outputModeration.flagged) {
      const escalation = {
        category: "safety",
        priority: "high" as const,
        reason: "The generated support response did not pass output moderation.",
      };
      const escalated = await escalateSupportThread(client, {
        threadId: input.thread.id,
        ...escalation,
        acknowledgement: escalationAcknowledgement(escalation),
        model: SUPPORT_MODEL,
        responseId: response.id,
        confidence: decision.confidence,
      });
      await recordSupportAiRun(client, {
        threadId: input.thread.id,
        triggerMessageId: latestUserMessage.id,
        responseMessageId: escalated.messageId,
        providerResponseId: response.id,
        model: SUPPORT_MODEL,
        outcome: "escalated_output_moderation",
        ...escalation,
        confidence: decision.confidence,
        moderation: { input: moderation, output: outputModeration },
      });
      return;
    }

    const reply = await addAutomatedSupportReply(client, {
      threadId: input.thread.id,
      body: normalizeReply(decision.reply),
      responseId: response.id,
      model: SUPPORT_MODEL,
      confidence: decision.confidence,
    });
    await recordSupportAiRun(client, {
      threadId: input.thread.id,
      triggerMessageId: latestUserMessage.id,
      responseMessageId: reply.messageId,
      providerResponseId: response.id,
      model: SUPPORT_MODEL,
      outcome: "answered",
      confidence: decision.confidence,
      moderation: { input: moderation, output: outputModeration },
    });
  } catch (error) {
    const errorCode = supportAiErrorCode(error);
    const escalation = {
      category: "technical_issue",
      priority: "high" as const,
      reason: `Automated support could not complete the request (${errorCode}).`,
    };
    const escalated = await escalateSupportThread(client, {
      threadId: input.thread.id,
      ...escalation,
      acknowledgement: "I couldn’t complete an automated answer, so I’ve sent this chat to a human support specialist.",
    });
    await recordSupportAiRun(client, {
      threadId: input.thread.id,
      triggerMessageId: latestUserMessage.id,
      responseMessageId: escalated.messageId,
      model: SUPPORT_MODEL,
      outcome: "provider_error",
      ...escalation,
      moderation,
      errorCode,
    });
    console.error("SUPPORT_AI_FAILED", {
      threadId: input.thread.id,
      userRole: input.role,
      errorCode,
    });
  }
}

async function getSupportAccountContext(client: DancrClient, userId: string, role: Exclude<UserRole, "admin">) {
  const { data: account, error: accountError } = await (client as any)
    .from("app_users")
    .select("role, display_name, account_state, created_at")
    .eq("id", userId)
    .single();
  if (accountError) throw accountError;

  const context: Record<string, unknown> = {
    role,
    displayName: account.display_name || null,
    accountState: account.account_state,
    accountCreatedAt: account.created_at,
  };

  if (role === "customer") {
    const { data, error } = await (client as any)
      .from("customer_profiles")
      .select("city, notification_settings, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    context.customerProfile = data || null;
  }

  if (role === "dancer") {
    const { data: dancer, error } = await (client as any)
      .from("dancer_profiles")
      .select("id, stage_name, city, status, verification_status, photo_review_status, is_public, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    context.dancerProfile = dancer || null;

    if (dancer?.id) {
      const [{ data: subscription, error: subscriptionError }, { data: shifts, error: shiftsError }] = await Promise.all([
        (client as any)
          .from("subscriptions")
          .select("status, current_period_end, updated_at")
          .eq("dancer_id", dancer.id)
          .maybeSingle(),
        (client as any)
          .from("shifts")
          .select("id, status, starts_at, ends_at, location_status, working_status, checked_in_at, checked_out_at")
          .eq("dancer_id", dancer.id)
          .order("starts_at", { ascending: false })
          .limit(5),
      ]);
      if (subscriptionError) throw subscriptionError;
      if (shiftsError) throw shiftsError;
      context.subscription = subscription || null;
      context.recentShifts = shifts || [];
    }
  }

  return context;
}

async function moderateSupportText(openai: OpenAI, text: string) {
  const result = await openai.moderations.create({
    model: "omni-moderation-latest",
    input: text,
  });
  const moderation = result.results[0];
  return {
    flagged: Boolean(moderation?.flagged),
    categories: moderation?.categories || {},
  };
}

function deterministicEscalationFor(message: string, aiReplyCount: number): DeterministicEscalation | null {
  const text = message.toLowerCase();
  const rules: Array<{ pattern: RegExp; category: string; priority: EscalationPriority; reason: string }> = [
    { pattern: /\b(human|real person|support agent|representative|manager)\b/, category: "human_requested", priority: "normal", reason: "The user explicitly requested human support." },
    { pattern: /\b(immediate danger|threat(?:en|ened)?|weapon|kill|suicide|self[- ]harm|traffick(?:ing|ed)?|minor|underage|stalk(?:ing|ed)?|coerc(?:ion|ed)|assault)\b/, category: "safety", priority: "urgent", reason: "The message reports a potentially urgent safety issue." },
    { pattern: /\b(harass(?:ment|ed)?|abuse|blackmail|doxx(?:ing|ed)?|impersonat(?:e|ion|ing))\b/, category: "harassment_abuse", priority: "high", reason: "The message reports harassment, abuse, or identity misuse." },
    { pattern: /\b(chargeback|unauthorized charge|fraud|refund|charged|billing|invoice|subscription|payout|commission payment)\b/, category: "billing", priority: "high", reason: "Billing and payment decisions require a human support specialist." },
    { pattern: /\b(delete my (?:account|data)|privacy request|data request|gdpr|ccpa|lawyer|legal|subpoena|law enforcement)\b/, category: "privacy_legal", priority: "high", reason: "Privacy, deletion, or legal requests require human review." },
    { pattern: /\b(can't log in|cannot log in|locked out|hacked|account taken|password reset failed)\b/, category: "account_access", priority: "high", reason: "The user needs account access or security assistance." },
    { pattern: /\b(verification|identity|government id|selfie).*\b(appeal|rejected|wrong|dispute|failed)\b|\b(appeal|dispute).*\b(verification|identity)\b/, category: "identity_verification", priority: "high", reason: "Identity and verification decisions require human review." },
    { pattern: /\b(appeal|wrong decision|unfair).*\b(moderation|approval|photo|profile|ban|rejected)\b/, category: "moderation_appeal", priority: "normal", reason: "Moderation and approval appeals require human review." },
    { pattern: /\bsecurity vulnerability|data breach|exploit\b/, category: "technical_issue", priority: "urgent", reason: "A potential security issue requires immediate human review." },
  ];
  const match = rules.find((rule) => rule.pattern.test(text));
  if (match) return { category: match.category, priority: match.priority, reason: match.reason };
  if (aiReplyCount >= SUPPORT_MAX_AUTOMATED_REPLIES) {
    return { category: "low_confidence", priority: "normal", reason: "The automated reply limit was reached." };
  }
  if (aiReplyCount >= 1 && /\b(still|again|didn't work|did not work|not fixed|same issue|you didn't answer)\b/.test(text)) {
    return { category: "technical_issue", priority: "normal", reason: "The user reports that earlier automated guidance did not resolve the issue." };
  }
  return null;
}

function highestPriorityEscalation(
  left: DeterministicEscalation | null,
  right: DeterministicEscalation | null,
) {
  if (!left) return right;
  if (!right) return left;
  const rank: Record<EscalationPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };
  return rank[right.priority] > rank[left.priority] ? right : left;
}

function escalationAcknowledgement(escalation: DeterministicEscalation) {
  if (escalation.priority === "urgent") {
    return "I’m escalating this to a human support specialist now. If anyone is in immediate danger, contact local emergency services and move to a safe place if possible.";
  }
  return "I’m sending this chat to a human support specialist because this request needs account-level review. They’ll see the full conversation here.";
}

function parseSupportDecision(value: string): SupportDecision {
  const parsed = JSON.parse(value || "{}") as Partial<SupportDecision>;
  const confidence = Number(parsed.confidence);
  if (
    typeof parsed.reply !== "string" ||
    typeof parsed.shouldEscalate !== "boolean" ||
    typeof parsed.escalationCategory !== "string" ||
    !["low", "normal", "high", "urgent"].includes(String(parsed.escalationPriority)) ||
    typeof parsed.escalationReason !== "string" ||
    !Number.isFinite(confidence)
  ) {
    throw new Error("Support AI returned an invalid structured response.");
  }
  return {
    reply: parsed.reply,
    shouldEscalate: parsed.shouldEscalate,
    escalationCategory: parsed.escalationCategory,
    escalationPriority: parsed.escalationPriority as EscalationPriority,
    escalationReason: parsed.escalationReason,
    confidence: Math.min(1, Math.max(0, confidence)),
  };
}

function normalizeReply(value: string) {
  const text = value.trim();
  if (!text) throw new Error("Support AI returned an empty response.");
  return text.slice(0, 2400);
}

function safetyIdentifier(userId: string) {
  return createHmac("sha256", getServerEnv("SUPABASE_SERVICE_ROLE_KEY"))
    .update(`dancr-support:${userId}`)
    .digest("hex");
}

function supportAiErrorCode(error: unknown) {
  if (!(error instanceof Error)) return "unknown_error";
  const anyError = error as Error & { status?: number; code?: string };
  if (anyError.status === 401) return "openai_auth_failed";
  if (anyError.status === 429) return "openai_rate_limited";
  if (anyError.status && anyError.status >= 500) return "openai_unavailable";
  if (anyError.code) return String(anyError.code).slice(0, 80);
  return "support_ai_failed";
}
