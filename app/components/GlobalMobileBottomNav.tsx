"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";

const DEFAULT_CITY = "Las Vegas";
const MOBILE_NAVIGATION_MAX_WIDTH = 720;
const MOBILE_SWIPE_EDGE_GUARD_PX = 20;
const MOBILE_SWIPE_DIRECTION_LOCK_PX = 10;
const MOBILE_SWIPE_MIN_DISTANCE_PX = 34;
const MOBILE_SWIPE_FLICK_DISTANCE_PX = 22;
const MOBILE_SWIPE_FLICK_VELOCITY_PX_MS = 0.32;
const MOBILE_SWIPE_MAX_DURATION_MS = 1400;
const MOBILE_SWIPE_HORIZONTAL_RATIO = 1.08;
const MOBILE_SWIPE_BLOCKED_SELECTOR = [
  "input",
  "select",
  "textarea",
  "[contenteditable]",
  "[role='slider']",
  "iframe",
  ".global-mobile-bottom-nav",
  "[data-carousel-swipe-surface]",
  "[data-global-navigation-swipe='ignore']",
  ".public-media-thumbnails",
  ".tv-strip-list",
  ".tv-video-viewer",
  ".profile-photo-viewer",
  ".profile-tv-strip-list",
  ".profile-tv-viewer",
].join(", ");

const destinations = [
  {
    id: "dancers",
    label: "Dancers",
    view: "dancers",
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
    view: "tv",
    icon: (
      <svg className="mydancr-tv-mark" viewBox="0 0 24 24" aria-hidden="true">
        <path className="mydancr-tv-play" d="m8.5 7.25 8 4.75-8 4.75v-9.5Z" />
        <path className="mydancr-tv-r" d="M17.05 8.35V4.35m0 1.45c.72-.95 1.62-1.25 2.7-.91" />
      </svg>
    ),
  },
  {
    id: "venues",
    label: "Clubs",
    view: "venues",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 20V7l7-3 7 3v13" />
        <path d="M3 20h18" />
        <path d="M9 10h6M9 14h6" />
      </svg>
    ),
  },
] as const;

export function GlobalMobileBottomNav() {
  const pathname = usePathname();
  const [city, setCity] = useState(DEFAULT_CITY);
  const navigation = useRef<HTMLElement>(null);
  const swipeIndicator = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const selectedCity = new URLSearchParams(window.location.search)
      .get("city")
      ?.trim();
    if (selectedCity) setCity(selectedCity);
  }, [pathname]);

  useEffect(() => {
    if (
      window.innerWidth > MOBILE_NAVIGATION_MAX_WIDTH ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const navigationElement = navigation.current;
    const frame = window.requestAnimationFrame(() => {
      navigationElement?.classList.add("is-introducing");
    });
    const timer = window.setTimeout(() => {
      navigationElement?.classList.remove("is-introducing");
    }, 1_100);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      navigationElement?.classList.remove("is-introducing");
    };
  }, []);

  useEffect(() => {
    const currentIndex = destinations.findIndex((destination) =>
      isActiveDestination(pathname, destination.id),
    );
    if (currentIndex < 0) return;

    const gesture = {
      startX: 0,
      startY: 0,
      startedAt: 0,
      tracking: false,
      axis: "pending" as "pending" | "horizontal" | "vertical",
    };

    const resetGesture = () => {
      gesture.startX = 0;
      gesture.startY = 0;
      gesture.startedAt = 0;
      gesture.tracking = false;
      gesture.axis = "pending";
      if (swipeIndicator.current) {
        swipeIndicator.current.classList.remove("is-visible", "is-ready");
        swipeIndicator.current.style.removeProperty("--mobile-swipe-opacity");
        swipeIndicator.current.style.removeProperty("--mobile-swipe-offset");
        swipeIndicator.current.style.removeProperty("--mobile-swipe-scale");
      }
    };

    const updateIndicator = (deltaX: number) => {
      const direction = deltaX < 0 ? 1 : -1;
      const nextIndex = currentIndex + direction;
      const indicator = swipeIndicator.current;
      if (!indicator || nextIndex < 0 || nextIndex >= destinations.length) {
        indicator?.classList.remove("is-visible", "is-ready");
        return;
      }
      const distance = Math.abs(deltaX);
      const progress = Math.min(1, distance / 84);
      const label = indicator.querySelector<HTMLElement>("[data-mobile-swipe-label]");
      const arrow = indicator.querySelector<HTMLElement>("[data-mobile-swipe-arrow]");
      if (label) label.textContent = destinations[nextIndex].label;
      if (arrow) arrow.textContent = direction > 0 ? "→" : "←";
      indicator.style.setProperty(
        "--mobile-swipe-opacity",
        String(progress * 0.96),
      );
      indicator.style.setProperty(
        "--mobile-swipe-offset",
        `${direction * (1 - progress) * 16}px`,
      );
      indicator.style.setProperty(
        "--mobile-swipe-scale",
        String(0.94 + progress * 0.06),
      );
      indicator.classList.toggle("is-ready", distance >= MOBILE_SWIPE_MIN_DISTANCE_PX);
      indicator.classList.add("is-visible");
    };

    const onTouchStart = (event: TouchEvent) => {
      resetGesture();
      if (
        window.innerWidth > MOBILE_NAVIGATION_MAX_WIDTH ||
        event.touches.length !== 1 ||
        mobileNavigationSwipeBlocked(event.target)
      ) {
        return;
      }
      const touch = event.touches[0];
      if (
        touch.clientX <= MOBILE_SWIPE_EDGE_GUARD_PX ||
        touch.clientX >= window.innerWidth - MOBILE_SWIPE_EDGE_GUARD_PX
      ) {
        return;
      }
      gesture.startX = touch.clientX;
      gesture.startY = touch.clientY;
      gesture.startedAt = performance.now();
      gesture.tracking = true;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!gesture.tracking || event.touches.length !== 1) {
        resetGesture();
        return;
      }
      const touch = event.touches[0];
      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;
      const distanceX = Math.abs(deltaX);
      const distanceY = Math.abs(deltaY);

      if (gesture.axis === "pending") {
        if (
          distanceX < MOBILE_SWIPE_DIRECTION_LOCK_PX &&
          distanceY < MOBILE_SWIPE_DIRECTION_LOCK_PX
        ) {
          return;
        }
        if (distanceY > distanceX * MOBILE_SWIPE_HORIZONTAL_RATIO) {
          gesture.axis = "vertical";
          resetGesture();
          return;
        }
        if (distanceX > distanceY * MOBILE_SWIPE_HORIZONTAL_RATIO) {
          gesture.axis = "horizontal";
        } else {
          return;
        }
      }

      if (gesture.axis !== "horizontal") return;
      updateIndicator(deltaX);
      if (event.cancelable) event.preventDefault();
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!gesture.tracking || event.changedTouches.length !== 1) {
        resetGesture();
        return;
      }
      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;
      const elapsed = Math.max(1, performance.now() - gesture.startedAt);
      const distanceX = Math.abs(deltaX);
      const velocity = distanceX / elapsed;
      const isHorizontal =
        distanceX > Math.abs(deltaY) * MOBILE_SWIPE_HORIZONTAL_RATIO;
      const isDeliberate =
        distanceX >= MOBILE_SWIPE_MIN_DISTANCE_PX ||
        (distanceX >= MOBILE_SWIPE_FLICK_DISTANCE_PX &&
          velocity >= MOBILE_SWIPE_FLICK_VELOCITY_PX_MS);
      const direction = deltaX < 0 ? 1 : -1;
      const nextIndex = currentIndex + direction;
      const shouldNavigate =
        elapsed <= MOBILE_SWIPE_MAX_DURATION_MS &&
        isHorizontal &&
        isDeliberate &&
        nextIndex >= 0 &&
        nextIndex < destinations.length;

      resetGesture();
      if (!shouldNavigate) return;
      if (event.cancelable) event.preventDefault();
      window.location.assign(destinationHref(destinations[nextIndex], city));
    };

    document.addEventListener("touchstart", onTouchStart, {
      passive: true,
      capture: true,
    });
    document.addEventListener("touchmove", onTouchMove, {
      passive: false,
      capture: true,
    });
    document.addEventListener("touchend", onTouchEnd, {
      passive: false,
      capture: true,
    });
    document.addEventListener("touchcancel", resetGesture, {
      passive: true,
      capture: true,
    });

    return () => {
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", resetGesture, true);
    };
  }, [city, pathname]);

  return (
    <>
      <div
        aria-hidden="true"
        className="global-mobile-swipe-indicator"
        ref={swipeIndicator}
      >
        <span data-mobile-swipe-arrow />
        <strong data-mobile-swipe-label />
      </div>
      <nav
        aria-label="Mobile primary navigation"
        className="global-mobile-bottom-nav"
        ref={navigation}
      >
        {destinations.map((destination) => {
          const active = isActiveDestination(pathname, destination.id);
          const href = homeDiscoveryHref(destination.view, city);
          return (
            <a
              aria-current={active ? "page" : undefined}
              className={`${active ? "active " : ""}${destination.id}-destination`}
              href={href}
              key={destination.id}
            >
              <span className="global-mobile-nav-icon">
                <span className="mobile-nav-selection-halo" aria-hidden="true" />
                {destination.icon}
              </span>
              <span>{destination.label}</span>
            </a>
          );
        })}
      </nav>
      <div
        aria-hidden="true"
        className="global-mobile-bottom-nav-fill"
      />
      <style jsx global>{`
        .global-mobile-bottom-nav,
        .global-mobile-bottom-nav-fill {
          display: none;
        }

        @supports (-webkit-touch-callout: none) and (height: 100svh) and
          (height: 100dvh) {
          :root {
            --dancr-mobile-nav-browser-clearance: min(
              52px,
              max(0px, calc(100dvh - 100svh))
            );
          }

          @media (max-width: 720px) {
            .global-mobile-bottom-nav-fill {
              position: fixed;
              z-index: 1498;
              left: 50%;
              bottom: 0;
              width: min(calc(100% - 18px), 698px);
              height: calc(
                26px + env(safe-area-inset-bottom) +
                  var(--dancr-mobile-nav-browser-clearance, 0px)
              );
              display: block;
              border-right: 1px solid rgba(248, 250, 252, 0.1);
              border-bottom: 1px solid rgba(248, 250, 252, 0.1);
              border-left: 1px solid rgba(248, 250, 252, 0.1);
              border-radius: 0 0 24px 24px;
              background: linear-gradient(
                180deg,
                rgba(8, 8, 11, 0.94),
                rgba(5, 5, 8, 0.98)
              );
              box-shadow: 0 18px 46px rgba(0, 0, 0, 0.46);
              pointer-events: none;
              transform: translateX(-50%);
            }
          }
        }

        @media (max-width: 720px) {
          body {
            padding-bottom: calc(
              94px + env(safe-area-inset-bottom) +
                var(--dancr-mobile-nav-browser-clearance, 0px)
            ) !important;
          }

          .global-mobile-swipe-indicator {
            --mobile-swipe-opacity: 0;
            --mobile-swipe-offset: 16px;
            --mobile-swipe-scale: 0.94;
            position: fixed;
            z-index: 1499;
            left: 50%;
            bottom: calc(
              91px + env(safe-area-inset-bottom) +
                var(--dancr-mobile-nav-browser-clearance, 0px)
            );
            min-height: 34px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 7px;
            padding: 7px 13px;
            border: 1px solid rgba(192, 132, 252, 0.3);
            border-radius: 999px;
            color: #f5f3ff;
            background: rgba(9, 7, 16, 0.88);
            box-shadow:
              0 12px 32px rgba(0, 0, 0, 0.42),
              0 0 22px rgba(124, 58, 237, 0.2);
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
              sans-serif;
            font-size: 12px;
            pointer-events: none;
            opacity: var(--mobile-swipe-opacity);
            transform:
              translate3d(-50%, 7px, 0)
              translateX(var(--mobile-swipe-offset))
              scale(var(--mobile-swipe-scale));
            transition:
              opacity 140ms ease,
              transform 140ms ease,
              border-color 140ms ease;
            visibility: hidden;
            will-change: opacity, transform;
          }

          .global-mobile-swipe-indicator.is-visible {
            visibility: visible;
          }

          .global-mobile-swipe-indicator.is-ready {
            border-color: rgba(126, 234, 255, 0.62);
            box-shadow:
              0 12px 32px rgba(0, 0, 0, 0.42),
              0 0 25px rgba(53, 216, 255, 0.24);
          }

          .global-mobile-swipe-indicator span {
            color: #7eeaff;
            font-size: 16px;
            line-height: 1;
          }

          .global-mobile-swipe-indicator strong {
            font-weight: 900;
          }

          .global-mobile-bottom-nav {
            position: fixed;
            z-index: 1500;
            left: 50%;
            bottom: calc(
              8px + env(safe-area-inset-bottom) +
                var(--dancr-mobile-nav-browser-clearance, 0px)
            );
            width: min(calc(100% - 16px), 700px);
            height: 72px;
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            align-items: center;
            gap: 0;
            padding: 3px 4px;
            overflow: hidden;
            border: 1px solid rgba(248, 250, 252, 0.16);
            border-radius: 25px;
            background:
              linear-gradient(
                180deg,
                rgba(255, 255, 255, 0.12),
                rgba(255, 255, 255, 0.04) 42%,
                rgba(255, 255, 255, 0.015)
              ),
              rgba(8, 8, 11, 0.94);
            box-shadow:
              0 18px 46px rgba(0, 0, 0, 0.46),
              inset 0 1px 0 rgba(255, 255, 255, 0.13),
              inset 0 0 0 1px rgba(255, 255, 255, 0.026);
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
            isolation: isolate;
            transform: translateX(-50%);
          }

          @supports (
              (backdrop-filter: blur(1px)) or
                (-webkit-backdrop-filter: blur(1px))
            ) {
            .global-mobile-bottom-nav {
              background:
                linear-gradient(
                  180deg,
                  rgba(255, 255, 255, 0.12),
                  rgba(255, 255, 255, 0.04) 42%,
                  rgba(255, 255, 255, 0.015)
                ),
                linear-gradient(
                  135deg,
                  rgba(18, 18, 23, 0.88),
                  rgba(4, 4, 7, 0.82)
                );
            }
          }

          .global-mobile-bottom-nav.is-introducing {
            animation: mobile-nav-dock-intro 680ms cubic-bezier(0.16, 1, 0.3, 1)
              both;
          }

          .global-mobile-bottom-nav.is-introducing
            a.active
            .mobile-nav-selection-halo {
            animation: mobile-nav-active-intro 1000ms ease-out 100ms both;
          }

          @keyframes mobile-nav-dock-intro {
            from {
              opacity: 0.12;
              transform: translateX(-50%) translateY(22px) scale(0.97);
            }
            to {
              opacity: 1;
              transform: translateX(-50%) translateY(0) scale(1);
            }
          }

          @keyframes mobile-nav-active-intro {
            0% {
              opacity: 0.18;
              transform: translate(-50%, -50%) scale(0.64);
            }
            55% {
              opacity: 1;
              transform: translate(-50%, -50%) scale(1.12);
            }
            100% {
              opacity: 1;
              transform: translate(-50%, -50%) scale(1);
            }
          }

          .global-mobile-bottom-nav,
          .global-mobile-bottom-nav * {
            box-sizing: border-box;
          }

          .global-mobile-bottom-nav a {
            --mobile-nav-accent: rgba(244, 242, 248, 0.86);
            --mobile-nav-accent-soft: rgba(244, 242, 248, 0.78);
            --mobile-nav-active: #f5f3ff;
            --mobile-nav-active-violet-core: rgba(124, 58, 237, 0.96);
            --mobile-nav-active-violet-glow: rgba(124, 58, 237, 0.58);
            --mobile-nav-active-violet-depth: rgba(49, 46, 129, 0.72);
            width: 100%;
            height: 65px;
            min-width: 0;
            display: grid;
            grid-template-rows: 36px 16px;
            align-content: center;
            align-items: center;
            justify-items: center;
            gap: 2px;
            padding: 3px 1px 2px;
            color: var(--mobile-nav-accent-soft);
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
              sans-serif;
            font-size: 11px;
            font-weight: 850;
            line-height: 16px;
            text-align: center;
            text-decoration: none;
            text-shadow: none;
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            user-select: none;
            transition:
              color 180ms ease,
              text-shadow 180ms ease;
          }

          .global-mobile-nav-icon {
            position: relative;
            isolation: isolate;
            width: 36px;
            height: 36px;
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

          .mobile-nav-selection-halo {
            position: absolute;
            z-index: 0;
            top: 50%;
            left: 50%;
            width: 48px;
            height: 48px;
            overflow: hidden;
            border-radius: 999px;
            -webkit-clip-path: circle(50% at 50% 50%);
            clip-path: circle(50% at 50% 50%);
            -webkit-mask-image: -webkit-radial-gradient(white, black);
            isolation: isolate;
            opacity: 0;
            pointer-events: none;
            transform: translate(-50%, -50%) scale(0.72);
            transition:
              opacity 180ms ease,
              transform 180ms ease;
          }

          .mobile-nav-selection-halo::before {
            content: "";
            position: absolute;
            inset: 8px;
            border-radius: 50%;
            background: radial-gradient(
              circle,
              rgba(245, 243, 255, 0.1) 0%,
              rgba(124, 58, 237, 0.34) 30%,
              rgba(124, 58, 237, 0.18) 56%,
              rgba(49, 46, 129, 0.14) 70%,
              transparent 82%
            );
            box-shadow:
              0 0 8px rgba(124, 58, 237, 0.18),
              0 0 16px rgba(49, 46, 129, 0.16);
            filter: blur(1.5px);
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
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.96);
          }

          .global-mobile-bottom-nav a.active .global-mobile-nav-icon {
            border: 0;
            border-radius: 0;
            color: var(--mobile-nav-active);
            background: transparent;
            box-shadow: none;
            filter: none;
            transform: translateY(-1px) scale(1.05);
          }

          .global-mobile-bottom-nav a.active .mobile-nav-selection-halo {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
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
            border: 0;
            border-radius: 0;
            color: var(--mobile-nav-active);
            background: transparent;
            box-shadow: none;
            filter: none;
          }

          .global-mobile-bottom-nav svg {
            position: relative;
            z-index: 1;
            width: 28px;
            height: 28px;
            overflow: visible;
            fill: none;
            filter: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
            transition: filter 180ms ease;
          }

          .global-mobile-bottom-nav a.active .global-mobile-nav-icon > svg {
            filter:
              drop-shadow(0 0 2px var(--mobile-nav-active-violet-core))
              drop-shadow(0 0 5px var(--mobile-nav-active-violet-glow))
              drop-shadow(0 0 9px var(--mobile-nav-active-violet-depth));
          }

          .global-mobile-bottom-nav a.tv-destination .mydancr-tv-mark {
            width: 28px;
            height: 28px;
            overflow: visible;
            fill: none;
            stroke: none;
          }

          .global-mobile-bottom-nav .mydancr-tv-play {
            fill: var(--mobile-nav-accent);
            filter: none;
            transform: scale(1.28);
            transform-box: fill-box;
            transform-origin: center;
            transition: fill 180ms ease;
          }

          .global-mobile-bottom-nav
            a.tv-destination.active
            .mydancr-tv-play {
            fill: var(--mobile-nav-active);
          }

          .global-mobile-bottom-nav .mydancr-tv-r {
            fill: none;
            stroke: var(--mobile-nav-accent-soft);
            stroke-width: 2.2;
            stroke-linecap: round;
            filter: none;
            transform: scale(1.28);
            transform-box: fill-box;
            transform-origin: center;
            transition: stroke 180ms ease;
          }

          .global-mobile-bottom-nav
            a.tv-destination.active
            .mydancr-tv-r {
            stroke: var(--mobile-nav-active);
          }

          @media (prefers-reduced-motion: reduce) {
            .global-mobile-swipe-indicator {
              transition: none;
            }

            .global-mobile-bottom-nav.is-introducing,
            .global-mobile-bottom-nav.is-introducing
              a.active
              .mobile-nav-selection-halo {
              animation: none;
            }
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
  if (destination === "dancers") {
    return (
      pathname === "/tonight" ||
      pathname === "/dancers" ||
      pathname.startsWith("/dancers/")
    );
  }
  return pathname === `/${destination}` || pathname.startsWith(`/${destination}/`);
}

function destinationHref(
  destination: (typeof destinations)[number],
  city: string,
) {
  return homeDiscoveryHref(destination.view, city);
}

function mobileNavigationSwipeBlocked(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest(MOBILE_SWIPE_BLOCKED_SELECTOR))
  );
}
