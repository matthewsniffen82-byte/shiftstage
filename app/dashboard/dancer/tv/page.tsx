import Link from "next/link";
import DancerTvStudio from "../../DancerTvStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function DancerMyDancrTvStudioPage() {
  return (
    <>
      <nav className="tv-studio-page-nav">
        <Link href="/">mydancr</Link>
        <div>
          <Link href="/?dancr_dashboard=dancer">Dancer dashboard</Link>
          <Link href="/tv">MyDancr TV</Link>
        </div>
      </nav>
      <DancerTvStudio />
      <style>{`
        .tv-studio-page-nav { position: relative; z-index: 2; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 18px clamp(14px, 4vw, 54px) 0; background: #050507; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        .tv-studio-page-nav > a { color: #fff; font-weight: 950; text-decoration: none; }
        .tv-studio-page-nav div { display: flex; gap: 8px; }
        .tv-studio-page-nav div a { min-height: 38px; display: inline-flex; align-items: center; padding: 0 12px; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; color: #fff; background: rgba(255,255,255,.04); font-size: 12px; font-weight: 850; text-decoration: none; }
      `}</style>
    </>
  );
}
