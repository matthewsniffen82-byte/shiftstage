import Link from "next/link";
import styles from "./FloatingProfileHomeLink.module.css";

export function FloatingProfileHomeLink({
  city,
  profileType,
}: {
  city: string;
  profileType: "dancer" | "venue";
}) {
  const selectedCity = city.trim() || "Las Vegas";

  return (
    <Link
      aria-label={`Return from this full ${profileType} profile to the ${selectedCity} city screen`}
      className={styles.control}
      href={`/?city=${encodeURIComponent(selectedCity)}&view=tonight`}
      title={`Back to ${selectedCity}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 11.2 12 4l8 7.2" />
        <path d="M6.5 10.5V20h11v-9.5" />
        <path d="M9.5 20v-5.5h5V20" />
      </svg>
    </Link>
  );
}
