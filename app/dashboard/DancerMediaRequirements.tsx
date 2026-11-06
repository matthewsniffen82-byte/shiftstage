import { MIN_DANCER_ONBOARDING_PHOTOS, MIN_DANCER_ONBOARDING_VIDEOS } from "@/src/lib/dancr/media-limits";
import "./dancer-media-upload-rules.css";

export type MediaRequirementProgress = { photos: number; videos: number | null; hasMain: boolean };

export default function DancerMediaRequirements({ progress }: { progress?: MediaRequirementProgress }) {
  return <div className="dancer-media-required-summary">
    <div className="dancer-media-requirement-heading">
      <strong>{MIN_DANCER_ONBOARDING_PHOTOS} photos + {MIN_DANCER_ONBOARDING_VIDEOS} video required</strong>{" "}
      <span>· Extras optional</span>
    </div>
    {progress ? <span className="dancer-media-requirement-progress" role="status" aria-live="polite">
      Photos {Math.min(progress.photos, MIN_DANCER_ONBOARDING_PHOTOS)}/{MIN_DANCER_ONBOARDING_PHOTOS}
      {" · "}Videos {progress.videos === null ? "Checking…" : `${Math.min(progress.videos, MIN_DANCER_ONBOARDING_VIDEOS)}/${MIN_DANCER_ONBOARDING_VIDEOS}`}
      {!progress.hasMain ? " · Main photo needed" : ""}
    </span> : null}
    <span>Main photo counts; avatar doesn’t.</span>
    {progress ? <span>Submit to continue. Approval is required before your profile goes live.</span> : null}
  </div>;
}
