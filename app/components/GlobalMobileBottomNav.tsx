"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const DEFAULT_CITY = "Las Vegas";

const destinations = [
  {
    id: "tonight",
    label: "Now",
    path: "/tonight",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 11.2 12 4l8 7.2" />
        <path d="M6.5 10.5V20h11v-9.5" />
        <path d="M9.5 20v-5.5h5V20" />
      </svg>
    ),
  },
  {
    id: "dancers",
    label: "Dancers",
    path: "/dancers",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 20c.6-4.1 2.8-6.2 6.5-6.2s5.9 2.1 6.5 6.2" />
      </svg>
    ),
  },
  {
    id: "tv",
    label: "TV",
    path: "/tv",
    icon: (
      <svg className="mydancr-tv-mark" viewBox="0 0 24 24" aria-hidden="true">
        <path className="mydancr-tv-play" d="m8.5 7.25 8 4.75-8 4.75v-9.5Z" />
        <path className="mydancr-tv-r" d="M17.05 8.35V4.35m0 1.45c.72-.95 1.62-1.25 2.7-.91" />
      </svg>
    ),
  },
  {
    id: "venues",
    label: "Venues",
    path: "/venues",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 20V7l7-3 7 3v13" />
        <path d="M3 20h18" />
        <path d="M9 10h6M9 14h6" />
      </svg>
    ),
  },
  {
    id: "trending",
    label: "Trending",
    path: "/trending",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m4 17 5-5 3.5 3.5L20 8" />
        <path d="M15 8h5v5" />
      </svg>
    ),
  },
] as const;

export function GlobalMobileBottomNav() {
  const pathname = usePathname();
  const [city, setCity] = useState(DEFAULT_CITY);

  useEffect(() => {
    const selectedCity = new URLSearchParams(window.location.search)
      .get("city")
      ?.trim();
    if (selectedCity) setCity(selectedCity);
  }, [pathname]);

  return (
    <>
      <nav
        aria-label="Mobile primary navigation"
        className="global-mobile-bottom-nav"
      >
        {destinations.map((destination) => {
          const active = isActiveDestination(pathname, destination.id);
          const href = `${destination.path}?city=${encodeURIComponent(city)}`;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`${active ? "active " : ""}${destination.id}-destination`}
              href={href}
              key={destination.id}
            >
              <span className="global-mobile-nav-icon">{destination.icon}</span>
              <span>{destination.label}</span>
            </Link>
          );
        })}
      </nav>
      <style jsx global>{`
        .global-mobile-bottom-nav {
          display: none;
        }

        @media (max-width: 720px) {
          body {
            padding-bottom: calc(70px + env(safe-area-inset-bottom)) !important;
          }

          .global-mobile-bottom-nav {
            position: fixed;
            z-index: 1500;
            left: 50%;
            bottom: 0;
            width: min(100%, 720px);
            height: calc(70px + env(safe-area-inset-bottom));
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            align-items: start;
            gap: 0;
            padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
            overflow: hidden;
            border-top: 1px solid rgba(139, 92, 246, 0.3);
            background: rgba(6, 6, 10, 0.97);
            box-shadow: 0 -12px 32px rgba(0, 0, 0, 0.42);
            backdrop-filter: blur(22px) saturate(1.3);
            -webkit-backdrop-filter: blur(22px) saturate(1.3);
            transform: translateX(-50%);
          }

          .global-mobile-bottom-nav,
          .global-mobile-bottom-nav * {
            box-sizing: border-box;
          }

          .global-mobile-bottom-nav a {
            --mobile-nav-accent: #a78bfa;
            --mobile-nav-accent-soft: #ddd6fe;
            --mobile-nav-accent-glow: rgba(124, 58, 237, 0.42);
            --mobile-nav-hero-violet-glow: rgba(124, 58, 237, 0.78);
            --mobile-nav-hero-cyan-glow: rgba(34, 199, 255, 0.48);
            width: 100%;
            height: 57px;
            min-width: 0;
            display: grid;
            grid-template-rows: 30px 14px;
            align-content: center;
            align-items: center;
            justify-items: center;
            gap: 2px;
            padding: 3px 1px 2px;
            color: #aaa2b4;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
              sans-serif;
            font-size: 10px;
            font-weight: 850;
            line-height: 14px;
            text-align: center;
            text-decoration: none;
            text-shadow: none;
            transition:
              color 180ms ease,
              text-shadow 180ms ease;
          }

          .global-mobile-bottom-nav a.dancers-destination {
            --mobile-nav-accent: #c084fc;
            --mobile-nav-accent-soft: #e9d5ff;
            --mobile-nav-accent-glow: rgba(192, 132, 252, 0.4);
          }

          .global-mobile-bottom-nav a.tv-destination {
            --mobile-nav-accent: #f472b6;
            --mobile-nav-accent-soft: #fbcfe8;
            --mobile-nav-accent-glow: rgba(236, 72, 153, 0.44);
          }

          .global-mobile-bottom-nav a.trending-destination {
            --mobile-nav-accent: #e879f9;
            --mobile-nav-accent-soft: #f5d0fe;
            --mobile-nav-accent-glow: rgba(217, 70, 239, 0.4);
          }

          .global-mobile-nav-icon {
            width: 30px;
            height: 30px;
            display: grid;
            place-items: center;
            border: 0;
            border-radius: 0;
            color: #aaa2b4;
            background: transparent;
            box-shadow: none;
            filter: none;
            transition:
              color 180ms ease,
              filter 180ms ease,
              transform 180ms ease;
          }

          .global-mobile-bottom-nav a.active {
            color: #fff;
            text-shadow:
              0 0 7px var(--mobile-nav-hero-violet-glow),
              0 0 11px var(--mobile-nav-hero-cyan-glow);
          }

          .global-mobile-bottom-nav a.active .global-mobile-nav-icon {
            border: 0;
            color: #fff;
            background: transparent;
            box-shadow: none;
            filter:
              drop-shadow(0 0 5px var(--mobile-nav-hero-violet-glow))
              drop-shadow(0 0 10px var(--mobile-nav-hero-cyan-glow));
            transform: translateY(-1px);
          }

          .global-mobile-bottom-nav a.tv-destination {
            color: #bcb4c8;
          }

          .global-mobile-bottom-nav a.tv-destination .global-mobile-nav-icon {
            border: 0;
            border-radius: 0;
            color: #aaa2b4;
            background: transparent;
            box-shadow: none;
            filter: none;
          }

          .global-mobile-bottom-nav a.tv-destination.active {
            color: #fff;
          }

          .global-mobile-bottom-nav a.tv-destination.active
            .global-mobile-nav-icon {
            color: #fff;
            filter:
              drop-shadow(0 0 5px var(--mobile-nav-hero-violet-glow))
              drop-shadow(0 0 10px var(--mobile-nav-hero-cyan-glow));
          }

          .global-mobile-bottom-nav svg {
            width: 20px;
            height: 20px;
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
          }

          .global-mobile-bottom-nav a.tv-destination .mydancr-tv-mark {
            width: 20px;
            height: 20px;
            overflow: visible;
            fill: none;
            stroke: none;
          }

          .global-mobile-bottom-nav .mydancr-tv-play {
            fill: #aaa2b4;
            filter: none;
            transition: fill 180ms ease;
          }

          .global-mobile-bottom-nav
            a.tv-destination.active
            .mydancr-tv-play {
            fill: #fff;
          }

          .global-mobile-bottom-nav .mydancr-tv-r {
            fill: none;
            stroke: #aaa2b4;
            stroke-width: 1.8;
            stroke-linecap: round;
            filter: none;
            transition: stroke 180ms ease;
          }

          .global-mobile-bottom-nav
            a.tv-destination.active
            .mydancr-tv-r {
            stroke: #f9a8d4;
          }
        }
      `}</style>
    </>
  );
}

function isActiveDestination(
  pathname: string,
  destination: (typeof destinations)[number]["id"],
) {
  if (destination === "tonight") return pathname === "/tonight";
  return pathname === `/${destination}` || pathname.startsWith(`/${destination}/`);
}
