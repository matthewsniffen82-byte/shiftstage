# Password requirements

New MyDancr passwords, including password resets and changes, must contain:

- At least 6 characters.
- At least 1 ASCII capital letter (A–Z).
- At least 1 number (0–9).
- At least 1 punctuation or symbol character, such as ! @ # $.

Lowercase letters are allowed but are not required. Whitespace does not satisfy the special-character rule. The existing 1,024-character upper bound remains. Passwords are never trimmed or rewritten. These composition rules do not run during login, so existing credentials continue to work.

The shared validator in `src/lib/dancr/password-policy.ts` enforces these rules in the server signup and password-update routes. React password forms reuse it where they validate locally and share the requirements list. The legacy live shell has an equivalent validator covered by parity tests.

## Supabase configuration

Project: Dancr (`hfmzwadzabmgxkjzmqun`). Under Authentication → Sign In / Providers → Email, the minimum password length must be 6. Keep the existing leaked-password protection enabled. A password that meets the four format rules can still be rejected if Supabase identifies it as a known leaked password.

On September 7, 2026, the minimum was saved as 6 and visually verified after reloading the Email settings. Leaked-password protection remained enabled; the other email and session protections were unchanged.

Supabase's built-in composition dropdown has no uppercase + number + symbol option without also requiring lowercase. Keep its existing default of no additional required characters; MyDancr's server routes enforce the requested composition rules. Do not select the lowercase-required preset and silently add a fifth requirement. Direct calls to Supabase Auth are subject to its own configured policy, not MyDancr's route validation.

No user credentials, account records, email-confirmation settings, or existing sessions are modified by this policy update.
