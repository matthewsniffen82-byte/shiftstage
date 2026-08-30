"use client";

import { useEffect, useState } from "react";

type NetworkInformationLike = {
  effectiveType?: string;
  saveData?: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

type NavigatorWithConnection = Navigator & {
  connection?: NetworkInformationLike;
  mozConnection?: NetworkInformationLike;
  webkitConnection?: NetworkInformationLike;
};

export function canWarmAdjacentVideo(
  navigatorValue: Pick<NavigatorWithConnection, "connection" | "mozConnection" | "webkitConnection"> | null =
    typeof navigator === "undefined" ? null : navigator as NavigatorWithConnection,
) {
  const connection = networkInformation(navigatorValue);
  if (!connection) return true;
  if (connection.saveData) return false;
  return !new Set(["slow-2g", "2g"]).has(
    String(connection.effectiveType || "").toLowerCase(),
  );
}

export function useAdaptiveVideoWarmup() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const navigatorValue = navigator as NavigatorWithConnection;
    const connection = networkInformation(navigatorValue);
    const update = () => setAllowed(canWarmAdjacentVideo(navigatorValue));
    update();
    connection?.addEventListener?.("change", update);
    return () => connection?.removeEventListener?.("change", update);
  }, []);

  return allowed;
}

function networkInformation(
  navigatorValue: Pick<NavigatorWithConnection, "connection" | "mozConnection" | "webkitConnection"> | null,
) {
  return navigatorValue?.connection ||
    navigatorValue?.mozConnection ||
    navigatorValue?.webkitConnection ||
    null;
}
