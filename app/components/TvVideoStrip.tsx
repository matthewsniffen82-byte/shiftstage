import type { MyDancrTvVideo } from "@/src/lib/dancr/tv";

export function TvVideoStrip({
  title,
  videos,
  showDancerName = true,
}: {
  title: string;
  videos: MyDancrTvVideo[];
  showDancerName?: boolean;
}) {
  if (!videos.length) return null;

  return (
    <section className="tv-video-strip" aria-label={title}>
      <TvVideoStripStyles />
      <div className="tv-strip-head">
        <div>
          <span>MyDancr TV</span>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="tv-strip-list">
        {videos.map((video) => {
          const schedule = tvProfileShiftLabel(video);
          return (
            <article
              aria-label={`${video.dancer.stageName} MyDancr TV video, ${schedule.label}`}
              className="tv-strip-card"
              key={video.id}
            >
              <video autoPlay loop muted playsInline preload="metadata" src={video.videoUrl} />
              <div>
                {showDancerName ? <strong>{video.dancer.stageName}</strong> : null}
                <span className={`tv-strip-schedule ${schedule.className}`}>{schedule.label}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function tvProfileShiftLabel(video: MyDancrTvVideo) {
  if (video.shift?.isActive) {
    return { className: "is-now", label: "Working now" };
  }
  if (video.shift) {
    return {
      className: "is-upcoming",
      label: formatTvProfileShift(video.shift.startsAt, video.shift.timezone),
    };
  }
  return { className: "is-no-shift", label: "No shift posted" };
}

function formatTvProfileShift(startsAt: string, timeZone: string) {
  const date = new Date(startsAt);
  if (!Number.isFinite(date.getTime())) return "soon";
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone || "UTC",
    }).format(date).replace(",", "").replace(", ", " · ");
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date).replace(",", "").replace(", ", " · ");
  }
}

function TvVideoStripStyles() {
  return (
    <style>{`
      .tv-video-strip { max-width: 1120px; margin: 22px auto 0; display: grid; gap: 12px; }
      .tv-strip-head { display: flex; align-items: end; justify-content: space-between; gap: 14px; }
      .tv-strip-head > div { display: grid; gap: 5px; }
      .tv-strip-head span { color: #7eeaff; font-size: 10px; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
      .tv-strip-head h2 { margin: 0; font-size: clamp(22px, 4vw, 34px); }
      .tv-strip-list { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(190px, 240px); gap: 10px; overflow-x: auto; overscroll-behavior-inline: contain; scroll-snap-type: x proximity; padding-bottom: 4px; }
      .tv-strip-card { position: relative; min-height: 330px; overflow: hidden; border: 1px solid rgba(139,92,246,.3); border-radius: 10px; color: #fff; background: #08080b; text-decoration: none; scroll-snap-align: start; }
      .tv-strip-card video { width: 100%; height: 100%; min-height: 330px; display: block; object-fit: cover; background: #000; }
      .tv-strip-card::after { content: ""; position: absolute; inset: 42% 0 0; background: linear-gradient(180deg, transparent, rgba(0,0,0,.92)); }
      .tv-strip-card > div { position: absolute; z-index: 2; left: 12px; right: 12px; bottom: 12px; display: grid; gap: 5px; }
      .tv-strip-card strong { overflow: hidden; color: #fff; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 2px 8px rgba(0,0,0,.9); }
      .tv-strip-schedule { width: fit-content; max-width: 100%; padding: 4px 7px; overflow: hidden; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; color: #b8b2c4; background: rgba(7,7,12,.76); font-size: 10px; font-weight: 900; text-overflow: ellipsis; white-space: nowrap; }
      .tv-strip-schedule.is-now { border-color: rgba(77,236,157,.38); color: #80f3b6; background: rgba(31,143,87,.24); }
      .tv-strip-schedule.is-upcoming { border-color: rgba(126,234,255,.32); color: #9fefff; background: rgba(34,199,255,.16); }
      @media (max-width: 620px) {
        .tv-strip-list { grid-auto-columns: minmax(150px, 42vw); }
        .tv-strip-card, .tv-strip-card video { min-height: 270px; }
      }
    `}</style>
  );
}
