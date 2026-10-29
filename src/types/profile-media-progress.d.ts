declare module "@/public/profile-media-progress" {
  const mediaProgress: {
    mount(video: HTMLVideoElement, host: HTMLElement): () => void;
  };
  export default mediaProgress;
}
