declare module "@/public/profile-action-feedback" {
  const profileActionFeedback: {
    show(anchor: HTMLElement | undefined, message: string): void;
    dismiss(): void;
  };
  export default profileActionFeedback;
}
