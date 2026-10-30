import { formatVenueDayHours, isVenueWeeklyHours } from "@/src/lib/dancr/venue-weekly-hours";

export default function VenueReviewHours({ weeklyHours, fallback }: { weeklyHours: unknown; fallback: string }) {
  if (!isVenueWeeklyHours(weeklyHours)) return <>{fallback || "Not provided"}</>;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return <table className="venue-review-hours" aria-label="Weekly opening hours">
    <tbody>
      {[1, 2, 3, 4, 5, 6, 0].map(day => <tr key={day}>
        <th scope="row">{names[day]}</th>
        <td>{formatVenueDayHours(weeklyHours[day])}</td>
      </tr>)}
    </tbody>
  </table>;
}
