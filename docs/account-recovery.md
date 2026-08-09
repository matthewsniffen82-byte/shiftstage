# Account recovery operations

MyDancr account recovery must restore access without exposing whether an account exists or revealing a registered email to an unverified person.

## Password reset

- The public response is always neutral: if the submitted email belongs to an account, Supabase sends the reset link.
- Recovery links are single-use and expire according to the Supabase Auth configuration.
- Requests are limited by keyed hashes of both the network address and submitted email. Raw addresses and submitted emails are not stored in recovery telemetry.
- Before the dedicated rate-limit function reaches an environment, the application fails over to private, resolved database records keyed by deterministic UUIDs derived from those same hashes. It never stores the submitted address or email.
- Provider delivery errors are logged server-side and never used to confirm or deny account existence.
- A successful password change revokes every other active session and sends a security alert to the registered email.

## Forgotten sign-in email

- Requests enter the existing Admin content-report queue as `contact_message` records and include a case reference.
- The requester and `ACCOUNT_RECOVERY_SUPPORT_EMAIL` receive the same reference through Resend. The support message uses the requester’s reachable address as `Reply-To`.
- Never reveal the registered email, including a masked version, before ownership is verified.
- Never request passwords, reset codes, government-ID attachments, or payment information by email.

## Ownership checks

- **Dancer:** match the stage profile, city, account email, and approved venue affiliation. Identity documents must not be collected or stored by MyDancr.
- **Venue:** match the venue record and approved ownership/claim history. Confirm through the established business contact or venue access process.
- **Customer:** do not disclose account data when no independent recovery factor exists. Help the customer try password recovery for addresses they control, or create a new private account.
- **Admin:** internal administrators use the separate admin recovery process; public email-lookup requests never accept the admin role.

After ownership is verified, send a normal password-reset link to the registered account email. Resolve the Admin report and retain only the normal audit record—never copy identity evidence into the case notes.
