declare module "@/public/profile-action-feedback" {
  const profileActionFeedback: {
    show(anchor: HTMLElement | undefined, message: string, fallbackToViewport?: boolean): void;
    dismiss(): void;
  };
  export default profileActionFeedback;
}
