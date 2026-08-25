"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

export const VIDEO_SOUND_PREFERENCE_KEY = "mydancr.video-sound-muted.v1";
export const VIDEO_SOUND_PREFERENCE_EVENT = "mydancr:video-sound-preference";

export function readVideoSoundPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.sessionStorage.getItem(VIDEO_SOUND_PREFERENCE_KEY);
    return stored === "sound-on" ? false : true;
  } catch {
    return true;
  }
}

export function writeVideoSoundPreference(muted: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      VIDEO_SOUND_PREFERENCE_KEY,
      muted ? "muted" : "sound-on",
    );
  } catch {
    // The in-memory state still works when browser storage is unavailable.
  }
  window.dispatchEvent(
    new CustomEvent(VIDEO_SOUND_PREFERENCE_EVENT, { detail: { muted } }),
  );
}

export function useVideoSoundPreference(): [
  boolean,
  Dispatch<SetStateAction<boolean>>,
] {
  const [muted, setMutedState] = useState(true);
  const mutedRef = useRef(true);

  useEffect(() => {
    const syncPreference = (event?: Event) => {
      const eventMuted = event instanceof CustomEvent &&
        typeof event.detail?.muted === "boolean"
        ? event.detail.muted
        : null;
      const nextMuted = eventMuted ?? readVideoSoundPreference();
      mutedRef.current = nextMuted;
      setMutedState(nextMuted);
    };

    syncPreference();
    window.addEventListener(VIDEO_SOUND_PREFERENCE_EVENT, syncPreference);
    return () => {
      window.removeEventListener(VIDEO_SOUND_PREFERENCE_EVENT, syncPreference);
    };
  }, []);

  const setMuted = useCallback<Dispatch<SetStateAction<boolean>>>((value) => {
    const nextMuted = typeof value === "function"
      ? value(mutedRef.current)
      : value;
    mutedRef.current = nextMuted;
    setMutedState(nextMuted);
    writeVideoSoundPreference(nextMuted);
  }, []);

  return [muted, setMuted];
}
