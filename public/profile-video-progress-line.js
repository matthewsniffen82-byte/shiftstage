(function installProfileVideoProgressLine() {
  function start() {
    const controls = document.getElementById("modalVideoControls");
    const scrubber = document.getElementById("modalVideoProgress");
    if (!controls || !scrubber) return;

    let progress = controls.querySelector(".profile-modal-video-progress-line");
    if (!(progress instanceof HTMLCanvasElement)) {
      progress = document.createElement("canvas");
      progress.className = "profile-modal-video-progress-line";
      progress.setAttribute("aria-hidden", "true");
      controls.insertBefore(progress, scrubber);
    }

    let animationFrame = 0;
    const draw = () => {
      animationFrame = 0;
      const bounds = progress.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;

      const scale = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      const pixelWidth = Math.max(1, Math.round(bounds.width * scale));
      const pixelHeight = Math.max(1, Math.round(bounds.height * scale));
      if (progress.width !== pixelWidth || progress.height !== pixelHeight) {
        progress.width = pixelWidth;
        progress.height = pixelHeight;
      }

      const maximum = Math.max(0, Number(scrubber.max) || 0);
      const current = Math.min(maximum, Math.max(0, Number(scrubber.value) || 0));
      const ratio = maximum > 0 ? Math.min(1, current / maximum) : 0;
      const context = progress.getContext("2d");
      if (!context) return;

      context.clearRect(0, 0, pixelWidth, pixelHeight);
      context.fillStyle = "rgba(255, 255, 255, 0.18)";
      context.fillRect(0, 0, pixelWidth, pixelHeight);
      const playedWidth = ratio > 0
        ? Math.min(pixelWidth, Math.max(scale, Math.round(pixelWidth * ratio)))
        : 0;
      if (playedWidth > 0) {
        context.fillStyle = "#f8f8fa";
        context.fillRect(0, 0, playedWidth, pixelHeight);
      }
    };

    const scheduleDraw = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(draw);
    };

    const observer = new MutationObserver(scheduleDraw);
    observer.observe(scrubber, {
      attributes: true,
      attributeFilter: ["style", "value", "max", "aria-valuetext"],
    });
    observer.observe(controls, {
      attributes: true,
      attributeFilter: ["class", "hidden"],
    });
    scrubber.addEventListener("input", scheduleDraw);
    scrubber.addEventListener("change", scheduleDraw);
    window.addEventListener("resize", scheduleDraw, { passive: true });
    scheduleDraw();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
