# Password requirements

New MyDancr passwords, including password resets and changes, must contain:

- At least 6 characters.
- At least 1 ASCII capital letter (A–Z).
- At least 1 number (0–9).
- At least 1 punctuation or symbol character, such as ! @ # $.

Lowercase letters are allowed but are not required. Whitespace does not satisfy the special-character rule. The existing 1,024-character upper bound remains. Passwords are never trimmed or rewritten. These composition rules do not run during login, so existing credentials continue to work.

The shared validator in `src/lib/dancr/password-policy.ts` enforces these rules in the server signup and password-update routes. React password forms reuse it where they validate locally and share the requirements list. The legacy live shell has an equivalent validator covered by parity tests.

## Supabase configuration

Project: Dancr (`hfmzwadzabmgxkjzmqun`). Under Authentication → Sign In / Providers → Email, the minimum password length is 6 and **Prevent use of leaked passwords** is **off** (`PASSWORD_HIBP_ENABLED = false`). Only the four password-format rules above apply through MyDancr. Do not re-enable common/leaked-password rejection without a new owner instruction.

On September 7, 2026, the owner explicitly confirmed removal of the extra common/leaked-password check after a password meeting the four listed rules was rejected. The switch was disabled and saved, then verified off after reloading Supabase and reopening the Email settings. The previously configured six-character minimum, email confirmation, secure email change, and session settings were preserved.

Supabase's built-in composition dropdown has no uppercase + number + symbol option without also requiring lowercase. Keep its existing default of no additional required characters; MyDancr's server routes enforce the requested composition rules. Do not select the lowercase-required preset and silently add a fifth requirement. Direct calls to Supabase Auth are subject to its own configured policy, not MyDancr's route validation.

No user credentials, account records, email-confirmation settings, or existing sessions are modified by this policy update.
