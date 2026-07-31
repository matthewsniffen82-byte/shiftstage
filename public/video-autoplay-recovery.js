(() => {
  "use strict";

  const HOME_FEED_VIDEO_SELECTOR = ".home-tv-feed-video";
  const preparedVideos = new WeakSet();
  let scanFrame = 0;

  function isActiveHomeFeedVideo(video) {
    const slide = video.closest(".home-tv-feed-slide");
    if (!slide) return false;
    if (slide.dataset.userPaused === "true") return false;
    if (slide.getAttribute("aria-current") === "true") return true;
    return !document.querySelector('.home-tv-feed-slide[aria-current="true"]') &&
      slide === document.querySelector(".home-tv-feed-slide");
  }

  async function playActiveVideo(video) {
    if (
      document.visibilityState === "hidden" ||
      !isActiveHomeFeedVideo(video) ||
      !video.paused
    ) {
      return;
    }

    video.autoplay = true;
    video.defaultMuted = true;
    try {
      await video.play();
      return;
    } catch (error) {
      if (error?.name === "AbortError" || !isActiveHomeFeedVideo(video)) return;
    }

    if (!video.muted) {
      video.muted = true;
      try {
        await video.play();
      } catch (error) {
        if (error?.name !== "AbortError") {
          video.closest(".home-tv-feed-slide")?.classList.add("is-paused");
        }
      }
    }
  }

  function prepareVideo(video) {
    if (preparedVideos.has(video)) return;
    preparedVideos.add(video);
    video.defaultMuted = true;
    video.playsInline = true;
    video.addEventListener("canplay", () => {
      void playActiveVideo(video);
    });
    video.addEventListener("loadeddata", () => {
      void playActiveVideo(video);
    });
  }

  function scanHomeFeedVideos() {
    scanFrame = 0;
    const videos = document.querySelectorAll(HOME_FEED_VIDEO_SELECTOR);
    videos.forEach((video) => {
      prepareVideo(video);
      video.autoplay = isActiveHomeFeedVideo(video);
    });
    const activeVideo = [...videos].find(isActiveHomeFeedVideo);
    if (activeVideo) void playActiveVideo(activeVideo);
  }

  function queueHomeFeedVideoScan() {
    if (scanFrame) cancelAnimationFrame(scanFrame);
    scanFrame = requestAnimationFrame(scanHomeFeedVideos);
  }

  const observer = new MutationObserver(queueHomeFeedVideoScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") queueHomeFeedVideoScan();
  });
  window.addEventListener("pageshow", queueHomeFeedVideoScan);
  queueHomeFeedVideoScan();
})();
