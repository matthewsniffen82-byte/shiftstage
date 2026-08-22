# Venue onboarding and publication

MyDancr uses a request-first venue onboarding model. It does not pre-populate public venue pages and does not offer a claim-page workflow.

1. An authorized venue representative submits the public venue request form.
2. A MyDancr administrator reviews the request and completes any commercial agreement outside the application.
3. Approval creates a private venue workspace and one-time venue signup code. It does not create a public listing.
4. The representative uses that code to create the venue account. Venue accounts receive access only to their own venue dashboard; they never receive MyDancr administrator access.
5. The venue completes its public details, phone, hours, official logo, discovery cover, and at least one active Club Deal.
6. The venue previews the customer-facing page and explicitly publishes it.

Public venue, discovery, and feed queries require `venues.is_active = true`. The publication endpoint validates every required field again on the server before setting that value, so changing the browser interface cannot bypass the publication gate.

Administrators can hide a published venue when required. A hidden venue must be reviewed and republished by its connected venue manager; administrators cannot use the venue-management endpoint to activate a private draft.
