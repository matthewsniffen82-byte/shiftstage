import { readBoundedRequestBytes } from './bounded-json-body.ts';

const ROUTES = new Set(['home', 'tv', 'profile', 'venue', 'dashboard', 'auth', 'other']);
const LIMITS: Record<string, number> = { lcpMs: 3600000, cls: 100, interactionMaxMs: 60000, tvFirstPlayMs: 86400000, tvRebuffers: 10000 };

export function validatePerformanceReport(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.version !== 1 || typeof input.release !== 'string' || !/^[a-f0-9]{40}$/.test(input.release)
    || typeof input.route !== 'string' || !ROUTES.has(input.route)
    || typeof input.device !== 'string' || !['mobile', 'desktop'].includes(input.device)) return null;
  if (!input.metrics || typeof input.metrics !== 'object' || Array.isArray(input.metrics)) return null;
  const metrics: Record<string, number> = {};
  for (const [name, value] of Object.entries(input.metrics)) {
    if (!Object.hasOwn(LIMITS, name) || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > LIMITS[name]) return null;
    metrics[name] = Math.round(value * 10000) / 10000;
  }
  if (!Object.keys(metrics).length) return null;
  // Only allowlisted fields reach logs; discard extra input, headers and URLs.
  return { event: 'performance.sample', version: 1, sampleRate: 0.01, release: input.release,
    route: input.route, device: input.device, metrics };
}

// Cheap best-effort log-volume ceiling per warm function instance. This is
// observational data, never an authorization or billing decision.
export function createPerformanceReceiver(log: (report: NonNullable<ReturnType<typeof validatePerformanceReport>>) => void, now = Date.now) {
  let windowStart = now(), received = 0;
  return async (request: Request) => {
    const respond = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'private, no-store' } });
    if (request.headers.get('origin') !== new URL(request.url).origin) return respond(403);
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return respond(415);
    if (now() - windowStart >= 60000) { windowStart = now(); received = 0; }
    if (++received > 120) return respond(429);
    try {
      const bytes = await readBoundedRequestBytes(request, 2048, 'Report too large.', 3000);
      const report = validatePerformanceReport(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      if (!report) return respond(400);
      log(report);
      return respond(204);
    } catch { return respond(400); }
  };
}
