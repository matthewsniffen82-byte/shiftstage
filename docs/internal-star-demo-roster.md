# Star's Internal demo assignment

The owner confirmed on 2026-09-29 that Star (`lvdegen11`) is a demo/test profile and requested that she also appear live on the Internal roster at Echo House.

Apply `20260929130000_star_internal_demo.sql`, then the guarded operator script `scripts/enable-star-internal-demo.sql`. The script links Star's existing live assignment to an active Echo House affiliation and Both visibility. It does not change her photos, public profile, login, shift deadline, or pending Ondato verification.

The additional demo exception is restricted to Star's exact existing profile, shift and venue IDs, her existing operator-lock metadata, and the new explicit `star-test-v1` marker. It applies only while real age enforcement is disabled. Future shifts and other real accounts still require verification. Existing roster checks continue to enforce active accounts, venue status, moderation, affiliation, visibility, checkout and expiry.

To withdraw only the demo exception, remove `internalDemoProfile` from this shift's `shift_summary`. Internal visibility then follows the normal verified-account rules. This does not unpublish Star's external profile.
