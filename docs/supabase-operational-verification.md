# Supabase operational verification — 2026-09-07

This continuation follows the successful Stage 6 release `ab8550bf9b6e22ef9c70ec3698e41e066b3ecb95`. The scope is read-only operational verification and a narrow validation of an existing constraint. It does not reset production users, send test emails, purchase add-ons, restore over production, or rewrite historical records.

## Email DNS — confirmed configuration issue

**MEDIUM M12:** `_dmarc.mydancr.com` returns two separate DMARC TXT records. Both the system resolver and an independent query to `1.1.1.1` returned:

```text
v=DMARC1; p=none; adkim=s; aspf=s
v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;
```

Multiple DMARC records at a single target are discarded during policy discovery under [RFC 9989 §4.10](https://www.rfc-editor.org/rfc/rfc9989.html#section-4.10). This is a confirmed policy configuration defect, not proof that it caused a particular missing password-reset message. No DNS record was changed.

The authoritative nameservers are `ns43.domaincontrol.com` and `ns44.domaincontrol.com`. In the domain's DNS manager, reduce the `_dmarc` TXT entries to exactly one intended DMARC policy. Do not combine both policy values in a single TXT record. If the existing provider-managed quarantine policy is intended, retain its complete second value and remove the conflicting first entry **after checking a test message's aligned DKIM/SPF results**. Otherwise choose the intended monitoring policy explicitly; do not guess the domain owner's enforcement/reporting preference or change the existing report recipient arbitrarily.

Additional public DNS observations:

- `send.mydancr.com` publishes SPF `v=spf1 include:amazonses.com ~all`.
- `send.mydancr.com` has MX priority 10 pointing to `feedback-smtp.us-east-1.amazonses.com`.
- `resend._domainkey.mydancr.com` publishes a nonempty DKIM public key.

Record presence is not proof that the provider signs actual messages correctly. Resend delivery/bounce/suppression logs and message authentication headers remain unverified. No usable Resend API credential was configured in this isolated audit checkout; that says nothing about production's SMTP configuration.

## Database backups — availability verified, restoration untested

The signed-in Supabase dashboard lists physical daily backups for 2026-08-31 through 2026-09-07. The latest listed backup is **2026-09-07 10:09:24 UTC**. The oldest displayed is **2026-08-31 10:06:29 UTC**. These are observed available snapshots, not a guarantee of retention beyond the displayed window.

Point-in-time recovery is **not enabled**: its dashboard page offers the add-on. No paid add-on was enabled. Daily backups leave a potential recovery gap between snapshots; select a paid recovery option only after agreeing the required recovery point and cost.

Supabase explicitly states that database backups exclude Storage API objects. No separate storage-object backup/restoration was verified. A restoration drill still needs an isolated destination; no restore was attempted against production and no new paid project was created.

## Existing constraints — exception scan completed

| Existing check | Rows inspected | Violations | Action |
| --- | ---: | ---: | --- |
| `mydancr_tv_duration_check` | 30 | 0 | Validate the existing 1–30 second check with bounded lock/statement timeouts |
| `club_deals_liquor_free_check` | 39 | 1 | Preserve the inactive historical exception; do not force validation |

The Club Deal exception is inactive: the count of active violating rows is zero. Its original migration deliberately preserves inactive historical offers. New/updated rows remain protected by the existing unvalidated check; no policy is weakened and no historical row is deleted or rewritten.

`202609070005_validate_existing_tv_duration.sql` validates the existing TV check only. PostgreSQL rechecks current rows and aborts if a violation or timeout occurs. Record its application status explicitly after the tested commit has deployed; Vercel does not apply SQL automatically.

The migration passed a live rollback-only test; its SQL token fingerprint matched the repository file. The complete 1,598-test suite, TypeScript checks, zero-warning lint and production build passed before publication. No data-population build hook ran.

## Remaining inputs for real recovery tests

A staging project and designated disposable test account/email were requested. They are needed to test actual email delivery, expired/used links, a second browser/device and password update/login without changing a real user's credentials. No email send is assumed authorized for an unspecified address. Existing repository regression tests remain distinct from those live observations.
