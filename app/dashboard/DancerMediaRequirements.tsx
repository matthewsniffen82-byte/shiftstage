import { MIN_DANCER_ONBOARDING_PHOTOS, MIN_DANCER_ONBOARDING_VIDEOS } from "@/src/lib/dancr/media-limits";
import "./dancer-media-upload-rules.css";

export type MediaRequirementProgress = { photos: number; videos: number | null; hasMain: boolean };

export default function DancerMediaRequirements({ progress }: { progress?: MediaRequirementProgress }) {
  return <div className="dancer-media-required-summary" role={progress ? "status" : undefined}>
    <span className="dancer-media-requirement-counts">
      {progress ? <>
        Photos {Math.min(progress.photos, MIN_DANCER_ONBOARDING_PHOTOS)}/{MIN_DANCER_ONBOARDING_PHOTOS}
        {" · "}Videos {progress.videos === null ? "Checking…" : `${Math.min(progress.videos, MIN_DANCER_ONBOARDING_VIDEOS)}/${MIN_DANCER_ONBOARDING_VIDEOS}`}
      </> : <>{MIN_DANCER_ONBOARDING_PHOTOS} photos · {MIN_DANCER_ONBOARDING_VIDEOS} video</>}
      {" · Extras optional"}
    </span>
    {progress && !progress.hasMain ? <span>{progress.photos >= MIN_DANCER_ONBOARDING_PHOTOS
      ? "Choose one of your photos as your main photo."
      : `Your main photo counts toward the ${MIN_DANCER_ONBOARDING_PHOTOS} photos.`}</span> : null}
  </div>;
}
