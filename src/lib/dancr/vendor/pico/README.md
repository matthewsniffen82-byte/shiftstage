# Pico face localization

MIT-licensed picojs runtime and Pico facefinder cascade by Nenad Markus.

- Runtime source: https://raw.githubusercontent.com/nenadmarkus/picojs/afffa50ec4134a47005f2cbf8112eaa69f65f37e/pico.js
- Model source: https://raw.githubusercontent.com/nenadmarkus/pico/7d550c78b2c31a4e1dfc5bcdfe9da013297b5cc8/rnt/cascades/facefinder
- Model SHA-256: d8014993e7298c7b1865d1f8b855d6dbf4ec5c808bf879e2091ab6837abf90cd

Local changes: declare the pico object, export it as an ES module, omit the unused video detection memory helper, and separate comma-chained byte assignments for lint compatibility. The cascade is encoded as JSON so Next.js bundles it with the server without a runtime download or extra native dependencies.

Used only to locate faces for avatar framing; the existing avatar verification and moderation remain authoritative.
