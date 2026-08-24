# Venue onboarding and publication

MyDancr uses a request-first venue onboarding model. It does not pre-populate public venue pages and does not offer a claim-page workflow.

1. An authorized venue representative submits the public venue request form.
2. A MyDancr administrator reviews the request and completes any commercial agreement outside the application.
3. Approval creates a private venue workspace and one-time venue signup code. It does not create a public listing.
4. The representative uses that code to create the venue account. Venue accounts receive access only to their own venue dashboard; they never receive MyDancr administrator access.
5. MyDancr prepares the private page: public details, phone, hours, official logo, discovery cover, and the contracted active Club Deal.
6. A MyDancr administrator sends the complete private page to the connected venue account for review.
7. The venue previews the page and either approves that exact version or returns a written correction request.
8. After venue approval, a MyDancr administrator performs the final check and publishes the page.

Public venue, discovery, and feed queries require `venues.is_active = true`. Venue approval records consent but never activates a listing. The admin publication action validates the requirements and the durable `venue_approved` workflow state again on the server before setting that value, so changing the browser interface cannot bypass either gate.

Administrators can hide a published venue when required. A hidden venue returns to the managed draft workflow and must receive new venue approval before MyDancr can publish it again.
