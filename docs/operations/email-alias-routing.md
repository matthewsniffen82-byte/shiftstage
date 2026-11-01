# Email aliases

`support@mydancr.com` is the primary Zoho mailbox. Each address below is an alias
on that mailbox, not another user or an email forwarding rule. Resend sends app
mail; Zoho receives incoming mail and human replies.

| Address | App use | Reply destination |
| --- | --- | --- |
| `no-reply@mydancr.com` | Confirmation, password/security, staff/club/VIP account setup links | `support@mydancr.com` |
| `notifications@mydancr.com` | Working Now, shifts, VIP/table/pickup updates, dancer approval results, club operational alerts | `support@mydancr.com` |
| `support@mydancr.com` | Support conversations and account recovery requests | `support@mydancr.com`; internal recovery requests preserve the requester's Reply-To |
| `approvals@mydancr.com` | Internal club applications, deal requests, page corrections and media reviews | `approvals@mydancr.com` |
| `safety@mydancr.com` | Internal report alerts and existing safety/privacy deadline reminders | `safety@mydancr.com` |
| `dmca@mydancr.com` | Copyright correspondence and internal copyright review alerts | `dmca@mydancr.com` |
| `updates@mydancr.com` | Opt-in club offer digests | `support@mydancr.com` |
| `billing@mydancr.com` | Reserved billing contact/category; no current app email generator | `billing@mydancr.com` |
| `ops@mydancr.com` | Reserved operations contact/category; no current app email generator | `ops@mydancr.com` |

## Delivery behavior

- `src/lib/dancr/email-routing.ts` controls app From and Reply-To headers.
- Existing `RESEND_API_KEY` and `EMAIL_FROM` configuration gates still control
  availability. `EMAIL_FROM` no longer overrides the category sender.
- Resend must have the `mydancr.com` sending domain verified. Aliases do not
  require separate Resend accounts.
- Supabase's separate SMTP configuration should retain `no-reply@mydancr.com`.
- New internal approval and copyright events queue one shared alias copy, using
  the existing durable delivery worker. Individual staff alerts remain intact.
  Historical events are not replayed. Safety/privacy shared copies remain owned
  by the existing case worker, avoiding duplicate shared alerts.
- Private account/setup links go only to their intended recipient; no shared
  CC/BCC. Existing verification, preferences, consent and unsubscribe checks
  still apply.
- Incoming Zoho mail is not automatically ingested into the app. Staff process
  replies in Zoho and use the authorized app dashboard for case actions.
- Stripe-issued billing messages and Vercel deployment alerts are configured in
  those providers separately. Defining billing/operations categories does not
  enable either provider's notifications.

## Rollout

Verified in Zoho on October 31, 2026: `support@mydancr.com` remains the mailbox
address; `dmca@` and `safety@` already existed. Added `notifications@`, `no-reply@`,
`approvals@`, `billing@`, `ops@` and `updates@` to that mailbox and confirmed all
eight aliases in the saved list. Other aliases were preserved.

The shared-recipient migration is `20261101003607_email_alias_routing.sql`
(its version uses UTC). No real messages are sent by unit or database tests.
