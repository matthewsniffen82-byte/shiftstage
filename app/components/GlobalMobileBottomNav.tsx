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
    if (/SamsungBrowser/i.test(window.navigator.userAgent)) {
      document.documentElement.classList.add("is-samsung-browser");
      document.body.classList.add("is-samsung-browser");
    }

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
            padding-bottom: calc(86px + env(safe-area-inset-bottom)) !important;
          }

          html.is-samsung-browser body {
            padding-bottom: calc(156px + env(safe-area-inset-bottom)) !important;
          }

          .global-mobile-bottom-nav {
            position: fixed;
            z-index: 1500;
            left: 50%;
            bottom: calc(8px + env(safe-area-inset-bottom));
            width: min(calc(100% - 16px), 700px);
            height: 64px;
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            align-items: center;
            gap: 0;
            padding: 3px 4px;
            overflow: visible;
            border: 1px solid rgba(255, 255, 255, 0.16);
            border-radius: 23px;
            background:
              linear-gradient(
                180deg,
                rgba(255, 255, 255, 0.1),
                rgba(255, 255, 255, 0.018) 42%,
                rgba(255, 255, 255, 0)
              ),
              radial-gradient(
                circle at 50% -42%,
                rgba(124, 58, 237, 0.22),
                transparent 54%
              ),
              radial-gradient(
                circle at 16% 0%,
                rgba(34, 199, 255, 0.08),
                transparent 34%
              ),
              rgba(7, 7, 12, 0.9);
            box-shadow:
              0 18px 44px rgba(0, 0, 0, 0.58),
              0 0 24px rgba(124, 58, 237, 0.15),
              0 0 0 1px rgba(139, 92, 246, 0.08),
              inset 0 1px 0 rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(26px) saturate(1.65);
            -webkit-backdrop-filter: blur(26px) saturate(1.65);
            isolation: isolate;
            transform: translateX(-50%);
          }

          html.is-samsung-browser .global-mobile-bottom-nav {
            bottom: calc(78px + env(safe-area-inset-bottom));
          }

          @supports (
              (backdrop-filter: blur(1px)) or
                (-webkit-backdrop-filter: blur(1px))
            ) {
            .global-mobile-bottom-nav {
              background:
                linear-gradient(
                  180deg,
                  rgba(255, 255, 255, 0.11),
                  rgba(255, 255, 255, 0.02) 42%,
                  rgba(255, 255, 255, 0)
                ),
                radial-gradient(
                  circle at 50% -42%,
                  rgba(124, 58, 237, 0.18),
                  transparent 54%
                ),
                radial-gradient(
                  circle at 16% 0%,
                  rgba(34, 199, 255, 0.06),
                  transparent 34%
                ),
                linear-gradient(
                  135deg,
                  rgba(20, 16, 34, 0.6),
                  rgba(5, 6, 12, 0.5)
                );
            }
          }

          .global-mobile-bottom-nav,
          .global-mobile-bottom-nav * {
            box-sizing: border-box;
          }

          .global-mobile-bottom-nav a {
            --mobile-nav-accent: #a78bfa;
            --mobile-nav-accent-soft: #ddd6fe;
            --mobile-nav-accent-glow: rgba(124, 58, 237, 0.42);
            --mobile-nav-hero-white-glow: rgba(255, 255, 255, 0.9);
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
            color: var(--mobile-nav-accent-soft);
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
              sans-serif;
            font-size: 10px;
            font-weight: 850;
            line-height: 14px;
            text-align: center;
            text-decoration: none;
            text-shadow:
              0 0 5px var(--mobile-nav-accent-glow),
              0 0 9px rgba(124, 58, 237, 0.17);
            touch-action: manipulation;
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
            color: var(--mobile-nav-accent);
            background: transparent;
            box-shadow: none;
            filter: none;
            transition:
              color 180ms ease,
              background 180ms ease,
              border-color 180ms ease,
              box-shadow 180ms ease,
              filter 180ms ease,
              transform 180ms ease;
          }

          .global-mobile-bottom-nav a:not(.active) .global-mobile-nav-icon {
            border: 0;
            border-radius: 0;
            background: transparent;
            box-shadow: none;
            filter: none;
          }

          .global-mobile-bottom-nav a.active {
            color: #fff;
            text-shadow:
              0 0 3px var(--mobile-nav-hero-white-glow),
              0 0 8px var(--mobile-nav-hero-violet-glow),
              0 0 14px var(--mobile-nav-hero-cyan-glow);
          }

          .global-mobile-bottom-nav a.active .global-mobile-nav-icon {
            border: 1px solid rgba(255, 255, 255, 0.24);
            border-radius: 10px;
            color: #fff;
            background: linear-gradient(
              145deg,
              rgba(124, 58, 237, 0.48),
              rgba(236, 72, 153, 0.22)
            );
            box-shadow:
              0 0 0 1px rgba(124, 58, 237, 0.22),
              0 0 14px rgba(124, 58, 237, 0.3);
            filter:
              drop-shadow(0 0 2px var(--mobile-nav-hero-white-glow))
              drop-shadow(0 0 7px var(--mobile-nav-hero-violet-glow))
              drop-shadow(0 0 13px var(--mobile-nav-hero-cyan-glow));
            transform: translateY(-2px) scale(1.08);
          }

          .global-mobile-bottom-nav a.tv-destination {
            color: var(--mobile-nav-accent-soft);
          }

          .global-mobile-bottom-nav a.tv-destination .global-mobile-nav-icon {
            border: 0;
            border-radius: 0;
            color: var(--mobile-nav-accent);
            background: transparent;
            box-shadow: none;
            filter: none;
          }

          .global-mobile-bottom-nav a.tv-destination.active {
            color: #fff;
          }

          .global-mobile-bottom-nav a.tv-destination.active
            .global-mobile-nav-icon {
            border: 1px solid rgba(255, 255, 255, 0.24);
            border-radius: 10px;
            color: #fff;
            background: linear-gradient(
              145deg,
              rgba(124, 58, 237, 0.48),
              rgba(236, 72, 153, 0.22)
            );
            box-shadow:
              0 0 0 1px rgba(124, 58, 237, 0.22),
              0 0 14px rgba(124, 58, 237, 0.3);
            filter:
              drop-shadow(0 0 2px var(--mobile-nav-hero-white-glow))
              drop-shadow(0 0 7px var(--mobile-nav-hero-violet-glow))
              drop-shadow(0 0 13px var(--mobile-nav-hero-cyan-glow));
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
            fill: var(--mobile-nav-accent);
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
            stroke: var(--mobile-nav-accent-soft);
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
