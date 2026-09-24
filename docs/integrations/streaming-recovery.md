# Streaming multipart backup verification

`scripts/recovery/verify-drive-parts-stream.mjs` verifies a complete multipart
backup without creating another installer or staging downloaded parts. It
compares each part's identity, order, size and SHA-256 with the completed
manifest, then checks the SHA-256 of the full ordered byte stream. The existing
`restore-drive-parts.mjs` remains the tool for reconstructing a local file.

## Input and receipts

Provide a completed manifest accepted by the restore helper and one NDJSON
record per part, in manifest order. Each record contains exactly `index`,
`driveFileId` and `downloadUrl`. The URL must be a fresh user-scoped HTTPS raw
download reference under `.oaiusercontent.com`; this verifier does not log into
Drive, list files, or obtain account tokens. It rejects redirects and sends no
cookies or authorization headers.

For a noninteractive stream, run `node scripts/recovery/verify-drive-parts-stream.mjs
manifest.json` with the records on standard input, then close that input. Never
save signed URLs in source, a command-history file, or a recovery receipt.

For an interactive Windows terminal, add `--tty` before the manifest path.
Wait for `ready:true` before supplying records; raw mode disables input echo.
Finish with a separate `{"end":true}` record. Terminal receipts use short lines
to avoid ConPTY wrapping; the full-file hash is printed as `SHA256 <hash>`.

Success requires the final receipt, the expected full-file hash and exit code
zero. A per-part success or still-running process is incomplete. Every success
explicitly says `restored:false`: bytes were verified, not written as a restored
file. Missing, duplicate, reordered, oversized, mismatched or stalled input
fails without authorizing removal of the original.

## Qualification and limits

The Windows test suite passed all 52 recovery tests. A live 28-part backup
containing 231,465,552 bytes passed independent ordered cloud readback, the
expected complete SHA-256 comparison and clean terminal exit. The terminal
framing also has synthetic success and timeout-exit checks. These checks do not
establish production database recovery, account reconnection, an off-device
recovery key or a complete installation restore.

The default verifier bounds input lines and chunks, streamed body chunks,
per-part time and waiting for input. It retains only bounded transfer buffers
and hash state rather than the complete source bytes. A process-level peak
memory measurement remains unqualified. Caller-supplied transport callbacks
must honor cancellation for embedded use.

Before a storage cutover, also retain the source manifest and recovery
instructions, verify their cloud copies, confirm the original is unchanged and
complete the applicable restore rehearsal. Stream verification alone never
deletes local data.
