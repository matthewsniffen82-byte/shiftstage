export default function handler(_request: unknown, response: any) {
  response.status(200).json({
    ok: true,
    service: "dancr",
    runtime: "vercel-function",
    time: new Date().toISOString(),
  });
}
