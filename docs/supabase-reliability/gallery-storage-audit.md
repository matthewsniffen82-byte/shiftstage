# Public gallery and original-file inventory

`npm run media:audit-gallery-storage` inspects one explicit dancer profile's public gallery directory or its corresponding private original directory. It reads metadata and references only. There is no apply option, deletion plan, scheduler or production request-path import.

This complements `media:reconcile-gallery-sources`, which only cleans verified old private upload copies. Historical public and original files lack a durable record of every publication attempt and retirement. An absent database reference—even for an old file—does not prove that a paused publisher cannot later reference it. This inventory supplies observations for that recovery work; it does not establish deletion safety.

## Run on a trusted maintenance host

Use the existing server environment for `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never put service credentials in command arguments, browser code or reports. The profile UUID must come from a verified operational record.

```sh
npm run media:audit-gallery-storage -- --profile=<profile UUID>
npm run media:audit-gallery-storage -- --profile=<profile UUID> --side=originals
npm run media:audit-gallery-storage -- --profile=<profile UUID> --limit=20 --offset=<nextOffset>
```

The default page contains at most ten entries; the hard maximum is twenty. Each invocation issues one storage listing, ordered by name, at the explicit offset. Continue each side separately until `nextOffset` is null. An exact full final page may require an empty final read. `pageLimitReached` identifies exhaustion of the allowed offset range and must not be treated as a complete scan. Concurrent uploads or removals can shift offset pages, so this is not a transactionally frozen inventory. Repeat the pass when a stable count matters.

## Scope and output

The command verifies the profile's owner, the public gallery bucket and the private original bucket before listing. It only recognizes root gallery filenames produced by the responsive uploader. Avatars in subdirectories, video posters, other buckets and unknown legacy names are not inferred to be gallery files. Folders are reported without recursion; unknown files retain their byte count when metadata is valid.

For each recognized master or derivative it checks exact master and derivative paths against gallery, avatar, moderation-final and moderation-source references, across all accounts and review states. The public master and archived original are independently checked for existence and valid metadata. No image is downloaded, no signed URL is generated, and no object or database row is changed. The CLI transport allows only the required metadata GET routes and storage's read-only list POST route; mutation, RPC, image-download and foreign-origin requests are rejected. Redirects are rejected and each request has a ten-second deadline.

Statuses:

- `referenced`: a gallery or avatar reference was observed, including rejected/history rows.
- `moderation_record_only`: a moderation reference was observed, with no gallery/avatar reference in these reads. This can include uncertain publication attempts and historical approvals.
- `no_known_reference`: none of the four checked reference fields matched. **This does not authorize deletion.**
- `unrecognized`: the filename does not match the supported gallery format; no reference inference is made.
- `folder_not_scanned`: a child directory was encountered; its contents and bytes are excluded.
- `verification_failed`: a provider read failed or returned invalid metadata. The command exits unsuccessfully; uncertainty is never presented as an absent reference.

`companions` reports the public master and original as `present` or `missing`. Only an explicit 404 means missing. A missing companion does not change whether a database reference was observed. A `present` result verifies metadata, not image decodability, all responsive variants or CDN delivery. `age` describes the selected object's creation/update metadata; seven days is an observation threshold, not deletion eligibility.

`observedBytes` sums valid sizes for the selected page only. Consult `byteCountComplete`; folder contents are outside this count. Object keys and publication keys are SHA-256 identifiers, with publication keys shared by the master, derivatives and archive across both sides. They are correlation identifiers, not approval tokens. Output omits raw paths, profile/account IDs, image contents and provider exception messages. Keep these reports in a private operational location.

## Recovery boundary

This audit cannot account for every historical manual writer, external consumer or unfinished transaction. Before adding public/original deletion, publication attempts need durable provenance and a retirement state that every writer honors. A future cleanup must coordinate reference creation with retirement, protect current media and originals, and distinguish acknowledged removal from an uncertain storage response. Do not feed `no_known_reference` results into a bulk deletion script.

Behavioral tests cover grouping, owner and cross-owner references, history/uncertain publication, both storage sides, missing companions, pagination, legacy retention, malformed/provider failures, privacy checks and the read-only transport. The audit changes no API, UI, database schema, RLS policy or video player behavior.
