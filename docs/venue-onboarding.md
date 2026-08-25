# Venue onboarding and publication

MyDancr uses a request-first venue onboarding model. It does not pre-populate public venue pages and does not offer a claim-page workflow.

1. An authorized venue representative submits the public venue request form.
2. A MyDancr administrator reviews the request and completes any commercial agreement outside the application.
3. Approval creates a private venue workspace and one-time venue signup code. It does not create a public listing.
4. The representative uses that code to create the venue account. Venue accounts receive access only to their own venue dashboard; they never receive MyDancr administrator access.
5. MyDancr prepares the private page: public details, verified latitude and longitude, phone, hours, official logo, optional detail-page cover, and the contracted active Club Deal.
6. A MyDancr administrator opens the complete private page in the exact customer venue-page renderer, checks the populated logo, hours, contact details, coordinates-driven actions, and active Club Deal, then sends that completed package to the connected venue account.
7. The venue reviews the same official information and commercial package, may open the same exact customer venue-page renderer, and either approves the package or returns a written correction request. MyDancr controls the venue-card and page presentation.
8. Approval publishes that exact completed page immediately. No separate venue editing or second MyDancr publication step is required.
9. MyDancr creates one in-app “Your venue card is live” notification for the active venue owner and team as soon as the first publication completes.

Public venue, discovery, and feed queries require `venues.is_active = true`. Before recording venue approval, the server verifies the complete MyDancr-managed page, valid map coordinates, official media, and active Club Deal. The database also rejects an active venue without both coordinates. An approved review atomically marks that exact page published and activates the listing, so changing the browser interface cannot bypass the completeness or venue-consent gates.

Administrators can hide a published venue when required. A hidden venue returns to the managed draft workflow and must receive new venue approval before it can become live again.
