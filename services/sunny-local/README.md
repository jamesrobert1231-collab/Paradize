# Sunny local conversation bridge

This is an independently authored, narrow adapter for the Unity island. It gives the owner access to local conversation without invoking the older Sunny coordinator's cloud defaults. It does not claim to consolidate historical knowledge, finance, connectors, approvals, workers, or account data.

## Launch contract

1. Run `provision.ps1` as the normal Windows account launching Unity. It creates `.runtime/sunny/token`, restricts directory and file access to that account and SYSTEM, and exports `PARADIZE_SUNNY_TOKEN_FILE` and `PARADIZE_SUNNY_PORT=4318` in that PowerShell process. It never prints the token. The parent launcher must ignore `.runtime/` in Git and preserve the environment when starting both Node and Unity.
2. Start `server.mjs` with the bundled Node runtime in that environment. It binds only `127.0.0.1`.
3. The Unity client reads the inherited token path into memory and sends `Authorization: Bearer <token>`. Do not serialize the token into Unity scenes, assets, PlayerPrefs, builds, logs, or diagnostics.

All routes require the owner token. Requests carrying Origin or forwarding headers are refused; this is a native local client interface. It is not the browser or iPhone gateway.

| Route | Request | Response |
| --- | --- | --- |
| `GET /health` | no body | `status`: `ready`, `model-unavailable`, `local-only-unconfirmed`, or `ollama-unavailable`; detected `model`; `paidRequestsEnabled:false` |
| `POST /chat` | `{message,history?:[{role,content}],knowledgeQuery?:string}` | `status:complete`, local answer; explicit knowledge requests include bounded excerpts and provenance, with no automatic fallback if the store fails |
| `GET /knowledge/search?q=...` | one query, at most 200 characters | up to five preserved excerpts with record IDs, original paths, hashes and uncertainty; no provider call |
| `GET /knowledge/original/<id>` | exact 64-character lowercase record ID; no query parameters | verified original bytes as an attachment, at most 10 MiB, with original SHA-256; no provider call |
| `POST /control/stop`, `POST /control/resume` | no body | persistent local conversation admission control when `controlFile` is configured |
| `POST /stop` | no body | abort current local conversation, `cancelled` boolean; does not imply global STOP of inherited systems |

Bodies are limited to 8 KiB, message to 4,000 characters, history to eight user/assistant messages of at most 2,000 characters each. System messages, custom URLs, model overrides, tools, provider names and unknown input fields are rejected. Only one inference is admitted at a time. Disconnect and STOP abort its request; timeout is 90 seconds. Disconnection is cancellation of the HTTP inference request, not a proof of whole-process container cancellation.

Only fixed `http://127.0.0.1:11434/api/status`, `/api/tags` and `/api/chat` endpoints are callable. Each health or conversation request first requires `/api/status` to report the literal Boolean `cloud.disabled:true`. Enabled, absent, malformed, oversized, failed or unsupported status blocks inference before conversation data is sent. Policy checks share a five-second deadline with model discovery and respect conversation cancellation. No policy result is cached between requests. Model selection prefers installed `qwen2.5:3b`, then installed `qwen3.5:4b`; cloud-tag metadata is rejected. There is no model installation, paid request, provider fallback or arbitrary tool execution. Original-document downloads read only the preserved, hash-checked knowledge store through the owner gate. They never fetch an arbitrary source path or execute a file. Runtime unload is requested after the answer to free memory for Unity. A running Ollama service is a prerequisite for conversation; source search and retrieval do not require it. A detected model is not a quality certification.

The token grants the rights of this local chat adapter to processes that can read the owner's protected file. It is not yet PARADIZE's final vault, persistent owner identity, device pairing or remote session system. Automatic launch preserves the existing token.

The standalone service now reads a bounded regular credential file and revalidates it before admitting requests and before successful JSON replies. A 250 ms polling interval also checks active work. Observed rotation, removal, malformed content, hard links or linked directories permanently invalidate that running service's credential guard, abort the active conversation (including an unfinished upload), and stop the standalone listener. Relaunch through the trusted launcher is required; a running service never adopts a replacement credential or resurrects one after an observed failure. The polling interval is not a hard real-time cancellation bound under a blocked event loop. Already-delivered bytes cannot be recalled.

Credential files remain under the launcher's owner/SYSTEM ACL contract; these Node checks are not a replacement for Windows ACL enforcement or containment from another process running as that owner. The guard does not create or rotate files, implement persistent per-device revocation, or qualify restored sessions. The final owner/device authority and revocation UI remain required. No live credential was changed to test this behavior.

## Verification

Run `.runtimes/node-v24.14.0-win-x64/node.exe --test services/sunny-local/server.test.mjs` from the repository root. Tests use synthetic credentials and an injected Ollama transport; they do not send real model requests. Boundary checks cover authorization, Origin and Host spoofing, fixed destinations, input limits, cloud-only models, provider failures, admission and cancellation. Real Unity/Ollama/normal-account ACL qualification is separate.

The running Ollama daemon is a trusted dependency, not a sandbox. This preflight check cannot contain a malicious daemon or atomically pin its identity across restart. A PARADIZE-managed local-only daemon and runtime qualification remain required; this source change does not modify shared Ollama configuration or activate a new player. See ../../docs/integrations/local-only-inference.md.

Launcher compatibility requires service=paradize-sunny-local, protocolVersion=2,
localOnlyPolicyRequired=true, and the strict Boolean paidRequestsEnabled=false.
These fields are emitted by this adapter; recognized health states include stopped
and unavailable, which indicate compatibility rather than inference readiness.
Start-Paradize.ps1 refuses to launch Unity if bridge compatibility cannot be confirmed.
It never automatically kills an older service. The version is not executable attestation.
