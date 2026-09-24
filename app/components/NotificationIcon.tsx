import { notificationIconName, type NotificationIconName } from "@/src/lib/dancr/notification-icon";

// Match the existing discovery action icons, including their 24px view box.
const paths: Record<NotificationIconName, string> = {
  personPlus: "M12 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0M3 20a5.5 5.5 0 0 1 11 0M18 8.5v6M15 11.5h6",
  heart: "M20.8 8.6c0 5.3-8.8 10.4-8.8 10.4S3.2 13.9 3.2 8.6A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.9Z",
  share: "M21 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0M9 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0M8.6 10.7l6.8-4.4M8.6 13.3l6.8 4.4",
  clock: "M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0M12 7.5v5l3.2 2",
  calendar: "M5.5 5.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2ZM7.5 3v5M16.5 3v5M3.5 10h17",
  car: "m5 11 1.7-4.3A2.7 2.7 0 0 1 9.2 5h5.6a2.7 2.7 0 0 1 2.5 1.7L19 11M4 11h16a1 1 0 0 1 1 1v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a1 1 0 0 1 1-1ZM6.5 15h.01M17.5 15h.01M6 19v2M18 19v2",
  venue: "M4 20V8.5L12 4l8 4.5V20M8 20v-5h8v5M8 10h.01M12 10h.01M16 10h.01",
  check: "m5 12 4.2 4.2L19 6.5",
  report: "M5 21V4M5 5h11l-1.8 3L16 11H5",
  star: "M12 3l2.7 5.6 6.1.8-4.4 4.2 1.1 6-5.5-3-5.5 3 1.1-6-4.4-4.2 6.1-.8L12 3Z",
  message: "M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2ZM7 9h10M7 13h7",
  lock: "M7 10h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2ZM8 10V7a4 4 0 0 1 8 0v3",
  bell: "M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7ZM10 20a2 2 0 0 0 4 0",
};

export default function NotificationIcon({ notification }: { notification: { icon?: unknown; type?: unknown; payload?: unknown; title?: unknown } }) {
  const icon = typeof notification.icon === "string" && Object.hasOwn(paths, notification.icon)
    ? notification.icon as NotificationIconName : notificationIconName(notification);
  return <svg className="notification-type-icon" data-notification-icon={icon} aria-hidden="true" focusable="false" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    style={{ width: 20, height: 20, flex: "0 0 20px", color: "#b99af0" }}><path d={paths[icon]} /></svg>;
}
