export const dynamic = "force-dynamic";

function retiredTableQr() {
  return Response.json(
    { ok: false, error: "Table QR codes are retired. Open the club’s customer roster NFC setup in Site Admin." },
    { status: 410, headers: { "cache-control": "private, no-store" } },
  );
}

export { retiredTableQr as GET, retiredTableQr as POST };
