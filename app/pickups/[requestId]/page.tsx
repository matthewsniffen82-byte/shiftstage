import Link from "next/link";
export const dynamic = "force-dynamic";
export default function RetiredPickupPage() {
  return <section className="pickup-card"><h1>Pickup chat has closed</h1>
    <p>MyDancr now sends pickup contact forms to the club manager. To arrange a pickup, open the club page and send your contact details.</p>
    <p>The club will contact you directly to confirm availability and timing.</p>
    <Link className="pickup-primary" href="/?view=venues">Browse clubs</Link>
  </section>;
}
