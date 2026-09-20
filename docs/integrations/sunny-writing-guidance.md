# Sunny writing guidance

The native Unity conversation already sends writing requests through `POST /chat` in `services/sunny-local/server.mjs`. That request now includes a compact, reviewed adaptation of no-ai-slop in its system message. This same path handles ordinary and explicitly grounded conversations. No new UI mode, text classifier, provider, dependency or second editing call is introduced.

## Scope and preservation

- Preferences apply conditionally to prose Sunny composes. Editing a supplied draft requires an explicit owner request and returns a separate revision in the reply.
- Quotations, evidence, user wording, code, names, identifiers, paths, citations and uncertainty retain their meaning and exact wording. Writing audits are instructed to name observed patterns without guessing AI authorship.
- The server now forwards the validated owner message exactly, including surrounding whitespace. The existing nonblank, 4,000-character and 8 KiB request limits still apply. History and retrieved evidence are not transformed.
- There is no automatic rewriting of stored text or model output, no filesystem write in this flow and no revision migration. Historical conversation supplied by the client remains unchanged. Persistent revision storage is not implemented by this adapter.
- The existing local-only model selection, zero paid requests, STOP, owner authentication and timeout behavior remain in force. One successful request performs one local model-list lookup and one local inference; a failure does not start polishing or fallback requests.

These are prompt instructions plus deterministic transport/storage preservation. They do not guarantee that a model follows every stylistic rule or reproduces every quotation correctly. The owner must review generated drafts. No real-model writing-quality benchmark or rebuilt Unity release was run for this change.

## Provenance

Source: `vendor/upstream/petergyang/no-ai-slop/skills/no-ai-slop/SKILL.md` and adjacent `eval.md`, repository commit `000650b156983f5159695b441477f4e63b25dc85`.

The inspected `SKILL.md` SHA-256 is `1c1abfa4e447e2e96f02832cc3d31d8b298184027aab1bb4cf5aa33179dc2f81`. The source uses the MIT license, copyright 2026 Peter Yang. Its notice is retained in `services/sunny-local/writing-guidance.mjs`; the upstream snapshot and license are unchanged. The runtime uses the checked-in adaptation, not a dynamically loaded external skill.

The adaptation preserves the source's plain language, minimum-edit, personal-voice, factual-fidelity and detection principles. It deliberately omits unconditional banned-word replacement, a separate model evaluation loop and an instruction to ask for a draft on every conversation. Those behaviors would conflict with source fidelity, one-call local inference or Sunny's broader conversation flow.

## Verification

`node --test services/sunny-local/writing-guidance.test.mjs services/sunny-local/server.test.mjs services/sunny-local/knowledge.test.mjs`

The focused tests capture the existing local inference request and verify instruction delivery, exact owner/history content, untouched model response, unchanged imported-file hashes and provenance, and the exact two local transport requests on both successful and failed writing requests. They use synthetic data and a fake model transport, without a live model or paid provider.

On 2026-09-17, all 24 affected tests passed with Node v24.5.0, exit status 0. Syntax checks also passed for the server, guidance module and focused test file. Before implementation, two of the three new tests failed because the writing policy was absent; the existing no-retry behavior already passed.
