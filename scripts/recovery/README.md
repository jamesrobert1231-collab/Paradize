# Local synthetic recovery qualification

## Installer offload tools

The installer-offload helpers are separate from the bounded synthetic encrypted format below.
They preserve public installer packages; they do not back up private application data or credentials.

`drive-part.ps1` stages a numbered slice without changing its source. Its caller must record the
source hash, each part's length/hash and Drive ID, and successful download verification. A staged
slice or successful upload alone is not a complete backup.

`verify-drive-download.ps1` accepts a short-lived URL from a grounded Drive raw-file fetch,
the same Drive file ID, expected length, and SHA-256. It streams and checks the bytes using a
1 MiB buffer with bounded reads. Save only the returned receipt; do not persist signed URLs.

For a complete multipart backup, download all parts using their manifest filenames and run:

```powershell
node scripts/recovery/restore-drive-parts.mjs --verify-only manifest.json downloaded-parts
node scripts/recovery/restore-drive-parts.mjs manifest.json downloaded-parts C:\Restored\Installer.exe
```

The first command verifies every part and the concatenated original hash without creating another
full copy. The second additionally creates a new destination; it refuses overwrites and leaves
source parts untouched. The destination's parent must already exist. Use trusted local directories.

The version 1 manifest contains `backupId`, `sourceName`, `sourceBytes`, `sourceSha256` and ordered
`parts` entries with `index` (starting at 1), `filename`, `bytes`, `sha256`, and `driveFileId`.
Incomplete manifests intentionally fail verification. Verification never authorizes or performs
original deletion. The operator must separately confirm complete remote receipts, preserved
restore instructions, unchanged originals, and all local hard links before a scoped cleanup.

## Synthetic encrypted format

This dependency-free Node ES module demonstrates local encrypted backup and fresh-destination restoration. It is **not the production PARADIZE backup implementation**: database snapshots, Windows ACL provisioning, real credential recovery, Google Drive upload/readback, and large media archives remain unqualified. No network calls occur.

Run with Node 22 or later (tested here with Node 24.5.0). Create the archive and key parent directories first. They must be separate, and the key cannot live below the archive directory. Both outputs must be outside the source.

```powershell
node scripts/recovery/backup.mjs create C:\Synthetic\source C:\Synthetic\archives\sample.pzb C:\Synthetic\keys\sample.key
node scripts/recovery/backup.mjs restore C:\Synthetic\archives\sample.pzb C:\Synthetic\keys\sample.key C:\Synthetic\restored
node --test tests/recovery/backup.test.mjs
```

The source and existing outputs are never overwritten. Destination must not exist, even as an empty directory; its parent must already exist. Failed authentication or invalid manifest produces no destination. An I/O failure after validation may leave a partial destination or archive for inspection; a retry must use fresh paths. No automatic recursive deletion is performed by this tool.

API exports:

```javascript
await createEncryptedBackup({ sourceDir, archivePath, keyPath, maxInputBytes });
await restoreEncryptedBackup({ archivePath, keyPath, destinationDir, maxInputBytes });
```

Both return `{ version, fileCount, inputBytes }`. The optional input byte limit defaults to 16 MiB and can only reduce that ceiling. A 10,000-entry limit and encoded-manifest ceiling also apply. This in-memory format is deliberately bounded for synthetic qualification.

Format `PZBK0001`: 8-byte magic (also authenticated additional data), 12-byte random nonce, 16-byte AES-256-GCM tag, then ciphertext. The encrypted UTF-8 JSON manifest contains version 1 and entries. Directories have a portable relative path and type. Files additionally contain size, SHA-256, and canonical base64 data. The separate key file contains 32 cryptographically random bytes. Possession of both files permits decryption; do not store the key with the uploaded archive.

Restore authenticates the complete ciphertext and validates every entry, hash, size, parent directory, and case-insensitive path collision before creating output. Windows reserved names, alternate data stream syntax, absolute paths, traversal, and symbolic links/junctions exposed by Node lstat are rejected. File modification checks detect common source changes, but this is not a filesystem snapshot and cannot guarantee consistency under concurrent modification. Use quiescent synthetic input. A malicious process running as the same OS user can race filesystem operations; production containment and owner ACL qualification remain required. POSIX mode hints do not establish Windows access control. Timestamps, ACLs, alternate streams, hard-link identity, and special files are not backed up.

Tests only create synthetic content under unique `paradize-recovery-test-*` OS temporary directories and remove precisely those test-owned directories. They verify round-trip bytes, preserved empty directories, source preservation, limits, output refusal, junction rejection, wrong keys, truncation, tampering, authenticated unsafe paths, parent conflicts, and hash mismatch.
# Bounded installer snapshots

`prepare-drive-parts.ps1 -Prepare -Source <installer> -ManifestPath <new.json>`
hashes the whole installer and ordered parts in one locked Windows read. The default part
size is 64 MiB; memory buffering is 1 MiB. Supply `-ExpectedSourceSha256` to require a known
inventory hash. Preparation creates only the manifest, not another full installer copy.

Use the same helper with `-Stage -Source <installer> -ManifestPath <json> -Index 1
-DestinationDirectory <existing-directory>` to materialize one part. Staging checks source
size/timestamp and the part's precomputed hash before publishing it. It never uploads or
deletes originals. Populate Drive IDs only from real uploads, independently verify downloaded
parts, retain the manifest/recovery instructions, and recheck the original before any authorized
deletion. A prepared manifest alone is not evidence of a completed cloud backup.
