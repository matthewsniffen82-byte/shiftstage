"use client";

import { useEffect, useRef, useState } from "react";
import { clearInternalFollowReturn, completeInternalProfileFollow, internalFollowReturnDestination, readInternalFollowReturn } from "@/src/lib/dancr/internal-profile-auth-return";

export default function InternalFollowReturn() {
  const [error, setError] = useState("");
  const [destination, setDestination] = useState("");
  const [signIn, setSignIn] = useState("");
  const [busy, setBusy] = useState(true);
  const running = useRef(false);

  async function resume() {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError("");
    const params = new URLSearchParams(window.location.search);
    const state = params.get("state") || "";
    const record = readInternalFollowReturn(state);
    if (!record) {
      setError("Reopen the club link in the browser where you tapped Follow, then open the dancer's profile.");
      setBusy(false); running.current = false;
      return;
    }
    const back = internalFollowReturnDestination(record);
    setDestination(back);
    setSignIn(`/account?role=customer&return_to=${encodeURIComponent(`/internal/follow-return?state=${state}`)}`);
    try {
      if (params.get("cancel") !== "1") await completeInternalProfileFollow(record.dancerId);
      clearInternalFollowReturn(state);
      window.location.replace(back);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The follow could not be saved. Try again.");
      setBusy(false); running.current = false;
    }
  }

  useEffect(() => { void resume(); }, []);

  return <main className="ir-shell">
    <h1>{busy ? "Returning to your profile…" : "Finish following"}</h1>
    {busy ? <p role="status">Saving your follow and reopening the club profile.</p> : <>
      <p role="alert">{error}</p>
      {destination ? <div className="ir-actions">
        <button type="button" onClick={() => void resume()}>Try again</button>
        <a className="ir-secondary" data-sign-in-action href={signIn}>Sign in</a>
        <a href={destination}>Back to club profile</a>
      </div> : <button type="button" onClick={() => window.location.assign("/")}>Back to MyDancr</button>}
    </>}
  </main>;
}
