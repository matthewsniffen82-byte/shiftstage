# Uber universal deep links

The public ride controls now offer the club's free shuttle and open the [pickup request form](club-deal-transportation.md). They do not open Uber or record Uber click events. The following documents the retained legacy URL utility and analytics compatibility.

The legacy utility builds Uber's `https://m.uber.com/looking` universal app link to hand a public venue destination to Uber. The destination is encoded in Uber's `drop[0]` location object: `addressLine1` contains the public venue name, `addressLine2` contains the actual full postal address, and valid coordinates are added as a pair. The safely encoded `dropoff[nickname]` and `dropoff[formatted_address]` compatibility fields carry the same public destination for native Uber clients that still read the earlier keys. This avoids the older `/ul/` handoff, which can open the Uber app while losing its destination parameters.

Dancr does not select a ride, estimate a fare or pickup time, authenticate the rider, collect payment, or book and manage the trip. Those steps remain inside Uber.

The destination is always the venue's public name and postal address. Valid venue latitude and longitude are included only when both are available; an address-only destination remains supported. Dancer coordinates, customer pickup coordinates, private check-in data, home addresses, and unpublished venues are never used. Pickup is represented only by Uber's `pickup=my_location` instruction and is not sent to Dancr analytics.

No Uber API key is required for this deep-link-only implementation. The integration does not imply a referral commission, endorsement, or official partnership with Uber.

The legacy typed builder is `src/lib/dancr/uber.ts`. The React control retains the filename `app/components/UberRideButton.tsx` and its CSS classes for layout compatibility, but now links to `/rides/[venueId]`. The `/api/events` pipeline retains support for historical `uber_ride_link_clicked` events in the venue-direction analytics stream.
