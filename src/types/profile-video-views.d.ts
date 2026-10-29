declare module "@/public/profile-video-views" {
  const profileVideoViews: {
    mount(video: HTMLVideoElement, options: {
      videoId: string;
      isActive?: () => boolean;
      getAccessToken?: () => string | null | undefined;
      getSessionId?: () => string;
    }): () => void;
  };
  export default profileVideoViews;
}
