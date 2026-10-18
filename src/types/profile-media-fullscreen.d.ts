declare module "@/public/profile-media-fullscreen" {
  export type MediaFullscreenController = {
    set(active: boolean): Promise<void>;
    dispose(): void;
  };

  const mediaFullscreen: {
    createController(surface: HTMLElement, callbacks: {
      onChange(active: boolean): void;
      onLayout(): void;
    }): MediaFullscreenController;
  };

  export default mediaFullscreen;
}
