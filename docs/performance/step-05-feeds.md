# Step 5 — feed rendering and scrolling

Step 4 and its verification follow-up were pushed as `78067bf7` and `518107a8`; both reached Vercel success. The latest [verified release](https://vercel.com/ai-movie-jobs/shiftstage/GDeuyxQDLLMQ5ngnbM6iUkwrJaxv) passed live health, exact shell matching, profile playback/resource cleanup and the public feed resource journey. Its three-per-network measurements are in `step-04-after.json`.

## Evidence and scope

The active discovery/venue feeds use the classic application shell, not a large React list. Source inspection found existing content keys that avoid replacing identical lists, passive scroll handlers, frame scheduling and IntersectionObserver-based activation. Step 4 already bounded video players and fixed observer/lifecycle edge cases. Current live lists contain roughly 14 dancers and 17 venues; introducing virtualization would add scroll/focus/height complexity without a demonstrated large-list benefit.

Grouping and sorting repeatedly call `cityWallClock` through date-based daily rotation and upcoming schedule helpers. Each call constructed an identical `Intl.DateTimeFormat`. An instrumented six-tap mobile CPU-4 journey measured **177–183 formatter constructions per tap**, **172.9–216.6 ms synchronous click work**, and **200.8–278.5 ms to the second paint opportunity**. All filter counts, selected states, focus restoration and venue scroll activation passed before editing production code. These are lab interaction measurements, not field INP.

Three cold cellular runs per route establish the adjacent baseline in `step-05-before.json`: home LCP 1,336 ms, sampled interaction proxy 712 ms, longest task 316 ms; venue-feed LCP 1,420 ms. Initial transferred bytes were 926,096 and 714,434 respectively. The 5-second scroll samples had very few frames exceeding 50 ms; this step targets measured filter computation rather than claiming every scroll was previously slow.

## Change

Reuse only the formatter configuration keyed by time zone, bounded to 16 entries. Every date, working status, rotation seed and schedule result is still computed fresh. No data caching, route changes, reordered cards, new dependency, CSS or visible redesign is introduced. Tests cover midnight rollover, spring/fall daylight saving, different time zones, reuse across 200 calculations and eviction without incorrect results.

All 2,121 automated tests, TypeScript, lint, migration guard and production build passed. The automatic approval review blocked starting the temporary local preview server with no specific reason beyond “blocked by policy.” The public production regression/measurement script will therefore verify filter counts, focus, scroll activation and constructor/work reduction immediately after the established deployment. No local browser pass is claimed for this step.
