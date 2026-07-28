import Link from "next/link";
import type { MyDancrTvVideo } from "@/src/lib/dancr/tv";

export function TvVideoStrip({
  title,
  videos,
}: {
  title: string;
  videos: MyDancrTvVideo[];
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
        <Link href={`/tv/${videos[0].id}`}>Watch all</Link>
      </div>
      <div className="tv-strip-list">
        {videos.map((video) => (
          <Link className="tv-strip-card" href={`/tv/${video.id}`} key={video.id}>
            <video autoPlay loop muted playsInline preload="metadata" src={video.videoUrl} />
            <span className="tv-strip-play" aria-hidden="true">▶</span>
            <div>
              <strong>{video.dancer.stageName}</strong>
              <p>{video.caption}</p>
              {video.venue ? <small>{video.venue.name}</small> : null}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function TvVideoStripStyles() {
  return (
    <style>{`
      .tv-video-strip { max-width: 1120px; margin: 22px auto 0; display: grid; gap: 12px; }
      .tv-strip-head { display: flex; align-items: end; justify-content: space-between; gap: 14px; }
      .tv-strip-head > div { display: grid; gap: 5px; }
      .tv-strip-head span { color: #7eeaff; font-size: 10px; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
      .tv-strip-head h2 { margin: 0; font-size: clamp(22px, 4vw, 34px); }
      .tv-strip-head > a { min-height: 40px; display: inline-flex; align-items: center; padding: 0 14px; border: 1px solid rgba(34,199,255,.32); border-radius: 999px; color: #fff; background: rgba(34,199,255,.07); font-size: 12px; font-weight: 900; text-decoration: none; white-space: nowrap; }
      .tv-strip-list { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(190px, 240px); gap: 10px; overflow-x: auto; overscroll-behavior-inline: contain; scroll-snap-type: x proximity; padding-bottom: 4px; }
      .tv-strip-card { position: relative; min-height: 330px; overflow: hidden; border: 1px solid rgba(139,92,246,.3); border-radius: 10px; color: #fff; background: #08080b; text-decoration: none; scroll-snap-align: start; }
      .tv-strip-card video { width: 100%; height: 100%; min-height: 330px; display: block; object-fit: cover; background: #000; }
      .tv-strip-card::after { content: ""; position: absolute; inset: 42% 0 0; background: linear-gradient(180deg, transparent, rgba(0,0,0,.92)); }
      .tv-strip-card > div { position: absolute; z-index: 2; left: 12px; right: 12px; bottom: 12px; display: grid; gap: 5px; }
      .tv-strip-card p { margin: 0; color: #f5f0ff; font-size: 12px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .tv-strip-card small { color: #9fefff; }
      .tv-strip-play { position: absolute; z-index: 3; top: 12px; right: 12px; width: 38px; height: 38px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.2); border-radius: 50%; background: rgba(0,0,0,.58); font-size: 13px; }
      @media (max-width: 620px) {
        .tv-strip-list { grid-auto-columns: minmax(150px, 42vw); }
        .tv-strip-card, .tv-strip-card video { min-height: 270px; }
      }
    `}</style>
  );
}
