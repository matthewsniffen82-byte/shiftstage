# Internal table stickers: NTAG 424 DNA

Site Admin → Clubs → club account → **Table NFC stickers**.

Create table assignments individually or by number range. Each assignment needs
one NTAG 424 DNA sticker. Dressing-room check-in tags remain a separate system.

## Program and activate

1. Read the physical sticker’s seven-byte UID with a compatible reader. Enter it
   in **Sticker setup → Prepare sticker**. Preparation does not activate access.
2. Open **Show programming settings**. Use a programmer that supports NTAG 424 DNA
   authentication, AES key changes, NDEF file writes and Secure Dynamic Messaging
   (SDM). Writing the URL with a generic NFC URL writer does not configure SDM.
3. On a factory-new sticker, authenticate with its current administrator key.
   Install `metaKey` as application Key 1 and `fileKey` as Key 2. Write the exact
   `ndefHex` bytes to NDEF file 02, including the two-byte NLEN. This is one short
   URI record with identifier code 00 (no URL prefix compression).
4. Apply the generated file and SDM settings. `piccOffset`, `macInputOffset` and
   `macOffset` are **decimal byte offsets from the beginning of file 02**, including
   NLEN. Programmer interfaces accepting hex or little-endian values must convert
   them. Use AES mode, encrypted UID and read-counter mirroring, ASCII output and
   no encrypted file payload. CMAC input starts at CMAC output (empty input).
5. Change application Key 0 to `adminKey`; Key 0 controls writes and configuration.
   Authenticate again using that key and read back the file access settings to
   confirm unauthenticated writes and configuration changes are prohibited.
   Keep all generated keys private. Do not permanently lock the tag using a
   generic NFC app. Do not reset SDM counters after activation.
6. Tap the sticker on a phone, then choose **Open club**. The page must report
   **Sticker verified**. This checks the UID, cryptogram and advancing counter,
   but does not independently attest to the tag’s write-access configuration.
7. Refresh Site Admin and choose **Activate sticker**. Tap again and confirm the
   correct table’s grid. The club and its owner must be active for customer access.

If settings or a tap fail, leave the sticker inactive and check the programmer’s
readback against the generated settings. A copied test URL cannot be reused.
For a new physical sticker, disable the old table assignment, create a replacement
assignment and provision the new UID. Disabled assignments retain past requests.

## Access behavior

- A verified fresh tap creates an HttpOnly browser cookie valid for exactly 3,600
  seconds. No location permission, customer sign-in or external NFC API is used.
- Refreshing and browsing never extend it. A tap during the same active session
  keeps that session’s original expiry. After expiry, a new tap starts a new hour.
- All internal customer roster, profile, media and request endpoints check the
  grant. The UI clears its grid and profile at expiry. Already downloaded data
  cannot be recalled from someone’s device.
- A database row lock accepts each advancing tag counter once. Replays, lower
  counters, invalid cryptograms, wrong UIDs and disabled assignments are rejected.
- Disabling/reactivating a sticker changes its generation and revokes older
  grants. Old static QR/table URLs alone no longer authorize access.
- Club/admin previews require authenticated, scoped entry and remain read-only.

This verifies a tag-generated message, not continuing physical presence. Someone
could relay a fresh, unused message before its first use. The chip has no trusted
wall clock; a higher unused counter is not proof of a recent read. This system
does not enforce a geographic radius or detect when someone leaves the club.

## Server operations

The `internal_nfc_tags` table and counter function are service-role only, with RLS
enabled and no public access. Key material is AES-256-GCM encrypted, bound to the
tag ID, using a domain-separated key derived from the server service-role secret.
Plan re-encryption before rotating that secret; otherwise stored tag keys cannot
be decrypted. Session signatures use a separate derivation. Never put tag keys
in public environment variables, request logs, support transcripts or Git.

The tap landing page does not consume the message on GET. Opening the page and
pressing **Open club** submits verification; the query is removed from browser
history on load. A lost response may require tapping again. API responses are
private/no-store and do not expose the cryptographic keys.

Verification references: [NXP AN12196](https://www.nxp.com/docs/en/application-note/AN12196.pdf),
[NTAG 424 DNA datasheet](https://www.nxp.com/docs/en/data-sheet/NT4H2421Gx.pdf).
Automated checks use published NXP/NIST vectors and synthetic database/HTTP
fixtures. A physical programmed-sticker test is required before activation.
