"use client";

import { useCallback, useEffect, useState } from "react";

const SESSION_KEY = "dancrAuthSessionV1";

type NfcTag = {
  id: string;
  venueId: string;
  type: "dressing_room" | "cashier";
  label: string;
  status: "active" | "disabled" | "revoked";
  lastTappedAt: string | null;
  tapCount: number;
  createdAt: string;
};

export default function VenueNfcTagPanel() {
  const [tags, setTags] = useState<NfcTag[]>([]);
  const [type, setType] = useState<NfcTag["type"]>("dressing_room");
  const [label, setLabel] = useState("Dressing room");
  const [status, setStatus] = useState("Loading venue NFC tags…");
  const [programmingUrl, setProgrammingUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    const auth = authHeaders();
    if (!auth) return setStatus("Sign in required.");
    try {
      const response = await fetch("/api/venue/nfc-tags", { headers: auth, cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load NFC tags.");
      persistRefreshedSession(data.session);
      setTags(data.tags || []);
      setStatus(data.tags?.length ? "" : "Create the first tag, then write its one-time URL to a physical NFC sticker.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load NFC tags.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createTag(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const auth = authHeaders();
    if (!auth) return setStatus("Sign in required.");
    setIsSaving(true);
    setProgrammingUrl("");
    try {
      const response = await fetch("/api/venue/nfc-tags", {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ type, label }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to create NFC tag.");
      persistRefreshedSession(data.session);
      setProgrammingUrl(data.programmingUrl);
      setStatus(data.message);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create NFC tag.");
    } finally {
      setIsSaving(false);
    }
  }

  async function updateTag(tagId: string, action: "enable" | "disable" | "rotate") {
    const auth = authHeaders();
    if (!auth) return setStatus("Sign in required.");
    setIsSaving(true);
    setProgrammingUrl("");
    try {
      const response = await fetch("/api/venue/nfc-tags", {
        method: "PATCH",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ tagId, action }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to update NFC tag.");
      persistRefreshedSession(data.session);
      if (data.programmingUrl) setProgrammingUrl(data.programmingUrl);
      setStatus(data.message);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update NFC tag.");
    } finally {
      setIsSaving(false);
    }
  }

  async function copyProgrammingUrl() {
    try {
      await navigator.clipboard.writeText(programmingUrl);
      setStatus("Programming URL copied. Write it as an NDEF URL record, test it, then lock the sticker read-only.");
    } catch {
      setStatus("Copy failed. Select the programming URL manually.");
    }
  }

  return (
    <article className="info-panel venue-nfc-panel" id="venue-nfc-tags">
      <div>
        <span className="eyebrow">Physical venue access</span>
        <h2>NFC stickers</h2>
        <p>Dressing-room tags verify dancers and eligible profiles. Cashier tags redeem live Club Deals and record attribution.</p>
      </div>
      <form onSubmit={createTag}>
        <label>Placement
          <select value={type} onChange={(event) => {
            const next = event.target.value as NfcTag["type"];
            setType(next);
            setLabel(next === "dressing_room" ? "Dressing room" : "Main cashier");
          }}>
            <option value="dressing_room">Dressing room — dancer verification</option>
            <option value="cashier">Cashier — Club Deal redemption</option>
          </select>
        </label>
        <label>Sticker label
          <input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} required />
        </label>
        <button type="submit" disabled={isSaving}>{isSaving ? "Working…" : "Create programming URL"}</button>
      </form>
      {programmingUrl ? (
        <section className="nfc-programming" aria-label="One-time NFC programming URL">
          <strong>Shown once — program this sticker now</strong>
          <code>{programmingUrl}</code>
          <button type="button" onClick={copyProgrammingUrl}>Copy URL</button>
          <small>Write one NDEF URL record. Test it on iPhone and Android, then permanently lock the physical sticker. Rotating revokes this URL.</small>
        </section>
      ) : null}
      <div className="nfc-tag-list">
        {tags.map((tag) => (
          <section key={tag.id} className={`nfc-tag-row ${tag.status}`}>
            <div>
              <span>{tag.type === "dressing_room" ? "Dressing room" : "Cashier"}</span>
              <strong>{tag.label}</strong>
              <small>{tag.tapCount} confirmed {tag.tapCount === 1 ? "tap" : "taps"}{tag.lastTappedAt ? ` · Last ${formatDate(tag.lastTappedAt)}` : ""}</small>
            </div>
            <b>{tag.status}</b>
            {tag.status !== "revoked" ? (
              <div>
                <button type="button" disabled={isSaving} onClick={() => updateTag(tag.id, tag.status === "active" ? "disable" : "enable")}>
                  {tag.status === "active" ? "Disable" : "Enable"}
                </button>
                <button type="button" disabled={isSaving} onClick={() => updateTag(tag.id, "rotate")}>Rotate</button>
              </div>
            ) : null}
          </section>
        ))}
      </div>
      {status ? <p role="status">{status}</p> : null}
      <style>{`
        .venue-nfc-panel{display:grid;gap:16px}.venue-nfc-panel h2,.venue-nfc-panel p{margin:4px 0}.venue-nfc-panel>div>p{color:#b9accd;line-height:1.45}.venue-nfc-panel form{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end}.venue-nfc-panel label{display:grid;gap:6px;color:#cfc5de;font-size:12px;font-weight:900}.venue-nfc-panel input,.venue-nfc-panel select{min-height:46px;min-width:0;padding:0 11px;border:1px solid rgba(255,255,255,.14);border-radius:10px;color:#fff;background:#16131d;font:inherit}.venue-nfc-panel button{min-height:44px;padding:0 14px;border:1px solid rgba(146,102,255,.48);border-radius:10px;color:#fff;background:rgba(96,43,220,.32);font:inherit;font-weight:900;cursor:pointer}.venue-nfc-panel button:disabled{opacity:.6;cursor:wait}.nfc-programming{display:grid;gap:9px;padding:15px;border:1px solid rgba(69,255,165,.36);border-radius:12px;background:rgba(38,208,119,.07)}.nfc-programming code{overflow-wrap:anywhere;padding:10px;border-radius:8px;color:#c7ffe3;background:#070a08}.nfc-programming small{color:#9db5a8;line-height:1.4}.nfc-tag-list{display:grid;gap:8px}.nfc-tag-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:12px;padding:13px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.035)}.nfc-tag-row>div:first-child{display:grid;gap:2px}.nfc-tag-row span{color:#9d82ff;font-size:9px;font-weight:950;letter-spacing:.12em;text-transform:uppercase}.nfc-tag-row small{color:#938a9f}.nfc-tag-row b{color:#7dffbd;font-size:10px;text-transform:uppercase}.nfc-tag-row.disabled b,.nfc-tag-row.revoked b{color:#b4aabf}.nfc-tag-row>div:last-child{display:flex;gap:7px}@media(max-width:760px){.venue-nfc-panel form,.nfc-tag-row{grid-template-columns:1fr}.nfc-tag-row>div:last-child{display:grid;grid-template-columns:1fr 1fr}}
      `}</style>
    </article>
  );
}

function authHeaders() {
  try {
    const session = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
    if (!session?.accessToken) return null;
    return {
      authorization: `Bearer ${String(session.accessToken)}`,
      ...(session.refreshToken ? { "x-dancr-refresh-token": String(session.refreshToken) } : {}),
    };
  } catch {
    return null;
  }
}

function persistRefreshedSession(session: unknown) {
  if (!session || typeof session !== "object") return;
  try {
    const current = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null") || {};
    const next = session as Record<string, unknown>;
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({
      ...current,
      accessToken: typeof next.accessToken === "string" ? next.accessToken : current.accessToken,
      refreshToken: typeof next.refreshToken === "string" ? next.refreshToken : current.refreshToken,
      expiresAt: typeof next.expiresAt === "number" ? next.expiresAt : current.expiresAt,
    }));
  } catch {
    // A storage-restricted browser can continue with the current in-memory request.
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
