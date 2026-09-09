import "server-only";

import type { ClientOptions } from "openai";

// Share the module cache, never a credential-bearing client between requests.
// Public TV readers also import moderation utilities; they do not need the SDK.
export async function createOpenAIClient(options: ClientOptions) {
  const { default: OpenAI } = await import("openai");
  return new OpenAI(options);
}
