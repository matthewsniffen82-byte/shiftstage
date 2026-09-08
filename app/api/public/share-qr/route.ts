import QRCode from "qrcode";

export const runtime = "nodejs";

// Encode public MyDancr links only; never fetch a submitted URL.
export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get("url") || "";
  let target: URL;
  try {
    if (!input || input.length > 2048) throw new Error("Invalid link");
    target = new URL(input);
    const local = process.env.NODE_ENV !== "production"
      && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
      && target.origin === new URL(request.url).origin;
    const publicHost = ["mydancr.com", "www.mydancr.com"].includes(target.hostname)
      && target.protocol === "https:" && !target.port;
    const publicPath = /^\/(?:dancers|venues)\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/.test(target.pathname);
    const legacyPath = ["/", "/outputs/index.html"].includes(target.pathname)
      && Boolean(target.searchParams.get("profile") || target.searchParams.get("venue"));
    const allowedParams = new Set(["city", "profile", "venue", "media", "mediaIndex"]);
    if ((!publicHost && !local) || target.username || target.password
      || (!publicPath && !legacyPath)
      || [...target.searchParams.keys()].some((key) => !allowedParams.has(key))) {
      throw new Error("Invalid link");
    }
    target.hash = "";
  } catch {
    return Response.json({ error: "Choose a MyDancr profile or club link." }, {
      status: 400, headers: { "cache-control": "no-store" },
    });
  }

  try {
    const png = await QRCode.toBuffer(target.toString(), {
      width: 360, margin: 4, errorCorrectionLevel: "M",
      color: { dark: "#050507", light: "#ffffff" },
    });
    return new Response(new Uint8Array(png), {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "QR code unavailable. Please try again." }, {
      status: 503, headers: { "cache-control": "no-store" },
    });
  }
}
