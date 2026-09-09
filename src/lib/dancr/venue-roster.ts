export type VenueDancerAffiliation = {
  id: string;
  dancerId?: string;
  status: string;
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
  const dancerId = affiliation.dancerId || affiliation.dancer?.id;
  return workingNow.some((shift) => {
    if (dancerId && shift.dancerId) return shift.dancerId === dancerId;
    return Boolean(affiliation.dancer?.slug && shift.dancerSlug === affiliation.dancer.slug);
  });
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
    const identity = `${affiliation.dancer?.stageName || ""} ${affiliation.dancer?.city || ""}`.toLocaleLowerCase();
    return terms.every((term) => identity.includes(term));
  });
}
