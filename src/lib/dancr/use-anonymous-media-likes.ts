"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type MediaLikeType = "photo" | "video";
export type MediaLikeSeed = {
  mediaType: MediaLikeType;
  mediaId: string;
  likeCount?: number;
};
type MediaLikeState = { liked: boolean; likeCount: number; pending: boolean };

const MAX_QUERY_ITEMS = 50;

export function useAnonymousMediaLikes(seeds: MediaLikeSeed[]) {
  const normalizedSeeds = useMemo(() => dedupeSeeds(seeds), [seeds]);
  const seedSignature = normalizedSeeds
    .map((seed) => `${seed.mediaType}:${seed.mediaId}:${safeCount(seed.likeCount)}`)
    .join("|");
  const [states, setStates] = useState<Record<string, MediaLikeState>>(() => initialStates(normalizedSeeds));
  const statesRef = useRef(states);
  statesRef.current = states;

  useEffect(() => {
    const controller = new AbortController();
    setStates((current) => ({ ...initialStates(normalizedSeeds), ...current }));
    void Promise.all(chunk(normalizedSeeds, MAX_QUERY_ITEMS).map(async (items) => {
      if (!items.length) return [];
      const params = new URLSearchParams();
      items.forEach((item) => params.append(item.mediaType, item.mediaId));
      const response = await fetch(`/api/public/media-likes?${params.toString()}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !Array.isArray(payload.likes)) {
        throw new Error(payload.error || "Unable to load likes.");
      }
      return payload.likes as Array<MediaLikeSeed & { liked: boolean }>;
    })).then((groups) => {
      if (controller.signal.aborted) return;
      setStates((current) => {
        const next = { ...current };
        groups.flat().forEach((item) => {
          next[mediaLikeKey(item.mediaType, item.mediaId)] = {
            liked: item.liked === true,
            likeCount: safeCount(item.likeCount),
            pending: false,
          };
        });
        return next;
      });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [seedSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const stateFor = useCallback((mediaType: MediaLikeType, mediaId: string): MediaLikeState => (
    states[mediaLikeKey(mediaType, mediaId)] || { liked: false, likeCount: 0, pending: false }
  ), [states]);

  const toggle = useCallback(async (mediaType: MediaLikeType, mediaId: string) => {
    const key = mediaLikeKey(mediaType, mediaId);
    const previous = statesRef.current[key] || { liked: false, likeCount: 0, pending: false };
    if (previous.pending) return previous;
    const liked = !previous.liked;
    const optimistic = {
      liked,
      likeCount: Math.max(0, previous.likeCount + (liked ? 1 : -1)),
      pending: true,
    };
    setStates((current) => ({ ...current, [key]: optimistic }));
    try {
      const response = await fetch("/api/public/media-likes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mediaType, mediaId, liked }),
        credentials: "same-origin",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to update like.");
      const authoritative = {
        liked: payload.liked === true,
        likeCount: safeCount(payload.likeCount),
        pending: false,
      };
      setStates((current) => ({ ...current, [key]: authoritative }));
      return authoritative;
    } catch (error) {
      setStates((current) => ({ ...current, [key]: { ...previous, pending: false } }));
      throw error;
    }
  }, []);

  return { stateFor, toggle };
}

export function mediaLikeKey(mediaType: MediaLikeType, mediaId: string) {
  return `${mediaType}:${mediaId}`;
}

function dedupeSeeds(seeds: MediaLikeSeed[]) {
  return [...new Map(seeds
    .filter((seed) => seed.mediaId)
    .map((seed) => [mediaLikeKey(seed.mediaType, seed.mediaId), seed])).values()];
}

function initialStates(seeds: MediaLikeSeed[]) {
  return Object.fromEntries(seeds.map((seed) => [
    mediaLikeKey(seed.mediaType, seed.mediaId),
    { liked: false, likeCount: safeCount(seed.likeCount), pending: false },
  ]));
}

function chunk<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => (
    items.slice(index * size, index * size + size)
  ));
}

function safeCount(value: unknown) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}
