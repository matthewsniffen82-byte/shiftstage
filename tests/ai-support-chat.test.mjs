import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [aiSource, supportSource, routeSource, migrationSource, adminSource, liveAppSource] = await Promise.all([
  readFile(new URL("../src/lib/dancr/ai-support.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/support.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/support/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202607260001_ai_support_chat.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("authenticated customer, dancer, and venue messages use the automated support service", () => {
  assert.match(routeSource, /createRequestSupabaseContext\(request\)/);
  assert.match(routeSource, /account\.role !== "customer"[\s\S]*account\.role !== "dancer"[\s\S]*account\.role !== "venue"/);
  assert.match(routeSource, /createOwnSupportMessage/);
  assert.match(routeSource, /processAutomatedSupportMessage\(adminClient/);
  assert.match(routeSource, /getSupportThreadForAutomation\(adminClient/);
});

test("support AI uses the Responses API with private structured output and user safety identifiers", () => {
  assert.match(aiSource, /process\.env\.OPENAI_SUPPORT_MODEL \|\| "gpt-5\.6-luna"/);
  assert.match(aiSource, /openai\.responses[\s\S]*\.create/);
  assert.match(aiSource, /store: false/);
  assert.match(aiSource, /safety_identifier: safetyIdentifier\(input\.userId\)/);
  assert.match(aiSource, /type: "json_schema"/);
  assert.match(aiSource, /strict: true/);
  assert.match(aiSource, /reasoning: \{ effort: "low" \}/);
});

test("the chatbot grounds answers in live account data and cannot claim privileged actions", () => {
  assert.match(aiSource, /getSupportAccountContext\(client, input\.userId, input\.role\)/);
  assert.match(aiSource, /\.from\("app_users"\)/);
  assert.match(aiSource, /\.from\("dancer_profiles"\)/);
  assert.match(aiSource, /\.from\("subscriptions"\)/);
  assert.match(aiSource, /\.from\("shifts"\)/);
  assert.match(aiSource, /Do not invent account facts/);
  assert.match(aiSource, /You cannot modify accounts, issue refunds, approve profiles/);
});

test("safety, billing, access, verification, privacy, abuse, legal, and human requests escalate", () => {
  for (const requiredPhrase of [
    "human_requested",
    "billing",
    "account_access",
    "identity_verification",
    "moderation_appeal",
    "privacy_legal",
    "safety",
    "harassment_abuse",
    "technical_issue",
  ]) {
    assert.ok(aiSource.includes(requiredPhrase), `missing escalation category ${requiredPhrase}`);
  }
  assert.match(aiSource, /SUPPORT_MAX_AUTOMATED_REPLIES = 4/);
  assert.match(aiSource, /SUPPORT_CONFIDENCE_THRESHOLD = 0\.72/);
  assert.match(aiSource, /if \(input\.thread\.escalationStatus === "escalated"\) return/);
  assert.match(aiSource, /contact local emergency services/);
});

test("incoming and outgoing support text is moderated and provider failure goes to a human", () => {
  assert.match(aiSource, /omni-moderation-latest/);
  assert.ok((aiSource.match(/moderateSupportText\(/g) || []).length >= 3);
  assert.match(aiSource, /escalated_output_moderation/);
  assert.match(aiSource, /outcome: "provider_error"/);
  assert.match(aiSource, /I couldn’t complete an automated answer, so I’ve sent this chat to a human support specialist/);
});

test("support conversations and AI decisions persist in the production database", () => {
  assert.match(migrationSource, /create table if not exists public\.support_ai_runs/);
  assert.match(migrationSource, /sender_kind text not null default 'human'/);
  assert.match(migrationSource, /metadata jsonb not null/);
  assert.match(migrationSource, /escalation_status text not null default 'none'/);
  assert.match(migrationSource, /assigned_admin_id uuid references public\.app_users/);
  assert.match(migrationSource, /alter table public\.support_ai_runs enable row level security/);
  assert.match(supportSource, /\.from\("support_ai_runs"\)\.insert/);
  assert.match(supportSource, /sender_kind: "ai"/);
  assert.match(supportSource, /sender_kind: "human"/);
});

test("human escalations alert active admins and are prioritized in the staff inbox", () => {
  assert.match(supportSource, /notifyAdminsOfEscalation/);
  assert.match(supportSource, /\.eq\("role", "admin"\)/);
  assert.match(supportSource, /\.eq\("account_state", "active"\)/);
  assert.match(supportSource, /notification_type: "support_message"/);
  assert.match(supportSource, /escalationPriorityRank\(right\.escalationPriority\)/);
  assert.match(adminSource, /Awaiting human review/);
  assert.match(adminSource, /Dancr Support AI/);
  assert.match(adminSource, /Reply as human/);
  assert.match(adminSource, /customer, dancer, or venue/);
});

test("all live support interfaces use server data without a local fake fallback", () => {
  assert.match(liveAppSource, /Dancr Support AI/);
  assert.match(liveAppSource, /Human Support/);
  assert.match(liveAppSource, /human support specialist/);
  assert.doesNotMatch(liveAppSource, /supportStorageKey|readStoredSupportThreads|writeStoredSupportThreads|localSupportThread/);
  assert.match(liveAppSource, /getAuthenticatedJson\("\/api\/support"\)/);
  assert.match(liveAppSource, /postAuthenticatedJson\("\/api\/support"/);
});
