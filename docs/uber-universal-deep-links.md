# Uber universal deep links

Dancr uses Uber's `https://m.uber.com/ul/` universal deep link to hand a public venue destination to Uber. Dancr does not select a ride, estimate a fare or pickup time, authenticate the rider, collect payment, or book and manage the trip. Those steps remain inside Uber.

The destination is always the venue's public name and postal address. Valid venue latitude and longitude are included only when both are available; an address-only destination remains supported. Dancer coordinates, customer pickup coordinates, private check-in data, home addresses, and unpublished venues are never used. Pickup is represented only by Uber's `pickup=my_location` instruction and is not sent to Dancr analytics.

No Uber API key is required for this deep-link-only implementation. The integration does not imply a referral commission, endorsement, or official partnership with Uber.

The typed builder is `src/lib/dancr/uber.ts`, and the reusable React control is `app/components/UberRideButton.tsx`. The production homepage shell mirrors the same validation and encoding rules because it is served as a standalone live shell. Clicks use Dancr's existing `/api/events` pipeline with the `uber_ride_link_clicked` event and are stored in the existing venue-direction analytics stream, tagged with the ride source and event time.
