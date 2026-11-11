# MyDancr Sticker Programmer

Site Admin opens the Android app for a specific club and table. The app authenticates with the production MyDancr API, reads the chip UID, and programs file 02 on an NTAG 424 DNA sticker. A second NFC read goes through the same verification endpoint as a customer tap. Keys stay in memory on the phone.

## Release builds

Run `build.ps1` using PowerShell 7.4 or newer, JDK 17, Android SDK platform 35, and Android Build Tools 35.0.0. Supply the release PKCS12 keystore with `-Keystore` and its password through `MYDANCR_STICKER_STOREPASS`. The script fetches the pinned NTAG library revision, runs the Java protocol checks, and verifies the signed APK before writing it to `public/downloads`. Increment the manifest version code for each Android update.

The first release’s keystore and current-user DPAPI-protected password are stored under `%LOCALAPPDATA%\MyDancr\StickerProgrammerSigning` on the signing workstation. Retain a private backup of the keystore and a recoverable copy of its password for future updates. The build checks the original signing certificate fingerprint.
