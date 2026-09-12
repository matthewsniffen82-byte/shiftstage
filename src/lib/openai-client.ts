import "server-only";

import type { ClientOptions } from "openai";
import { serverJobSignal, withServerJobFetch } from "./server-job.ts";

// Share the module cache, never a credential-bearing client between requests.
// Public TV readers also import moderation utilities; they do not need the SDK.
export async function createOpenAIClient(options: ClientOptions) {
  const { default: OpenAI } = await import("openai");
  const jobOptions = serverJobSignal()
    ? { ...options, maxRetries: 0, fetch: withServerJobFetch(options.fetch || fetch) }
    : options;
  return new OpenAI(jobOptions);
}
