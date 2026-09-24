export type VenueDancerAffiliation = {
  id: string;
  dancerId?: string;
  status: string;
  reentryBlocked?: boolean;
  approvedAt?: string | null;
  dancer?: {
    id?: string;
    stageName?: string;
    slug?: string;
    city?: string;
    avatarUrl?: string | null;
    avatarSrcSet?: string | null;
  } | null;
};

export function isAffiliatedDancerWorkingNow(
  affiliation: VenueDancerAffiliation,
  workingNow: Array<Record<string, unknown>>,
) {
  return Boolean(findAffiliatedDancerCheckIn(affiliation, workingNow));
}

export function findAffiliatedDancerCheckIn(
  affiliation: VenueDancerAffiliation,
  workingNow: Array<Record<string, unknown>>,
) {
  const dancerId = affiliation.dancerId || affiliation.dancer?.id;
  return workingNow.find((shift) => {
    if (dancerId && shift.dancerId) return shift.dancerId === dancerId;
    return Boolean(affiliation.dancer?.slug && shift.dancerSlug === affiliation.dancer.slug);
  }) || null;
}

export function filterVenueAffiliations(
  affiliations: VenueDancerAffiliation[],
  workingNow: Array<Record<string, unknown>>,
  search: string,
  workingOnly: boolean,
) {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return affiliations.filter((affiliation) => {
    if (affiliation.status !== "active") return false;
    if (workingOnly && !isAffiliatedDancerWorkingNow(affiliation, workingNow)) return false;
    const stageName = (affiliation.dancer?.stageName || "").toLocaleLowerCase();
    return terms.every((term) => stageName.includes(term));
  });
}

export type VenueRosterEntry = {
  id: string;
  affiliation: VenueDancerAffiliation | null;
  dancer: VenueDancerAffiliation["dancer"];
  checkIn: Record<string, unknown> | null;
};

export function getVenueRosterEntries(
  affiliations: VenueDancerAffiliation[],
  workingNow: Array<Record<string, unknown>>,
  search: string,
  workingOnly: boolean,
): VenueRosterEntry[] {
  if (!workingOnly) {
    return filterVenueAffiliations(affiliations, workingNow, search, false).map((affiliation) => ({
      id: affiliation.id,
      affiliation,
      dancer: affiliation.dancer,
      checkIn: findAffiliatedDancerCheckIn(affiliation, workingNow),
    }));
  }

  // Presence and affiliation are separate records. Demo and older check-ins
  // can be present without an affiliation; never drop them from Working Now
  // or manufacture access-management permissions for them.
  const activeAffiliations = affiliations.filter((affiliation) => affiliation.status === "active");
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return workingNow.map((checkIn, index): VenueRosterEntry => {
    const affiliation = activeAffiliations.find((item) => isAffiliatedDancerWorkingNow(item, [checkIn])) || null;
    return {
      id: `check-in:${checkIn.shiftId || index}`,
      affiliation,
      dancer: affiliation?.dancer || {
        id: String(checkIn.dancerId || ""),
        stageName: String(checkIn.stageName || "Dancer"),
        slug: String(checkIn.dancerSlug || ""),
        avatarUrl: typeof checkIn.avatarUrl === "string" ? checkIn.avatarUrl : null,
        avatarSrcSet: typeof checkIn.avatarSrcSet === "string" ? checkIn.avatarSrcSet : null,
      },
      checkIn,
    };
  }).filter(({ dancer }) => terms.every((term) => (dancer?.stageName || "").toLocaleLowerCase().includes(term)));
}
