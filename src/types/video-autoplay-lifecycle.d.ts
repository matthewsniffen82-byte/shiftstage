declare module "@/public/video-autoplay-lifecycle" {
  const videoAutoplay: {
    mount(video: HTMLVideoElement, options: {
      isActive: () => boolean;
      play: () => unknown;
    }): () => void;
  };
  export default videoAutoplay;
}
