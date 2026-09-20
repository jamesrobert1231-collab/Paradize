# Sunny local conversation bridge

This is an independently authored, narrow adapter for the Unity island. It gives the owner access to local conversation without invoking the older Sunny coordinator's cloud defaults. It does not claim to consolidate historical knowledge, finance, connectors, approvals, workers, or account data.

## Launch contract

1. Run `provision.ps1` as the normal Windows account launching Unity. It creates `.runtime/sunny/token`, restricts directory and file access to that account and SYSTEM, and exports `PARADIZE_SUNNY_TOKEN_FILE` and `PARADIZE_SUNNY_PORT=4318` in that PowerShell process. It never prints the token. The parent launcher must ignore `.runtime/` in Git and preserve the environment when starting both Node and Unity.
2. Start `server.mjs` with the bundled Node runtime in that environment. It binds only `127.0.0.1`.
3. The Unity client reads the inherited token path into memory and sends `Authorization: Bearer <token>`. Do not serialize the token into Unity scenes, assets, PlayerPrefs, builds, logs, or diagnostics.

All routes require the owner token. Requests carrying Origin or forwarding headers are refused; this is a native local client interface. It is not the browser or iPhone gateway.

| Route | Request | Response |
| --- | --- | --- |
| `GET /health` | no body | `status`: `ready`, `model-unavailable`, or `ollama-unavailable`; detected `model`; `paidRequestsEnabled:false` |
| `POST /chat` | `{message,history?:[{role,content}],knowledgeQuery?:string}` | `status:complete`, local answer; explicit knowledge requests include bounded excerpts and provenance, with no automatic fallback if the store fails |
| `GET /knowledge/search?q=...` | one query, at most 200 characters | up to five preserved excerpts with record IDs, original paths, hashes and uncertainty; no provider call |
| `GET /knowledge/original/<id>` | exact 64-character lowercase record ID; no query parameters | verified original bytes as an attachment, at most 10 MiB, with original SHA-256; no provider call |
| `POST /control/stop`, `POST /control/resume` | no body | persistent local conversation admission control when `controlFile` is configured |
| `POST /stop` | no body | abort current local conversation, `cancelled` boolean; does not imply global STOP of inherited systems |

Bodies are limited to 8 KiB, message to 4,000 characters, history to eight user/assistant messages of at most 2,000 characters each. System messages, custom URLs, model overrides, tools, provider names and unknown input fields are rejected. Only one inference is admitted at a time. Disconnect and STOP abort its request; timeout is 90 seconds. Disconnection is cancellation of the HTTP inference request, not a proof of whole-process container cancellation.

Only fixed `http://127.0.0.1:11434/api/tags` and `/api/chat` endpoints are callable for inference. Model selection prefers installed `qwen2.5:3b`, then installed `qwen3.5:4b`; cloud-tag metadata is rejected. There is no model installation, paid request, provider fallback or arbitrary tool execution. Original-document downloads read only the preserved, hash-checked knowledge store through the owner gate. They never fetch an arbitrary source path or execute a file. Runtime unload is requested after the answer to free memory for Unity. A running Ollama service is a prerequisite for conversation; source search and retrieval do not require it. A detected model is not a quality certification.

The token grants the rights of this local chat adapter to processes that can read the owner's protected file. It is not yet PARADIZE's final vault, persistent owner identity, device pairing or remote session system. Restarting the server revokes in-memory copies only if the token is deliberately rotated first; automatic launch preserves the existing token. Live-token rotation and the final revocation UI remain future work.

## Verification

Run `.runtimes/node-v24.14.0-win-x64/node.exe --test services/sunny-local/server.test.mjs` from the repository root. Tests use synthetic credentials and an injected Ollama transport; they do not send real model requests. Boundary checks cover authorization, Origin and Host spoofing, fixed destinations, input limits, cloud-only models, provider failures, admission and cancellation. Real Unity/Ollama/normal-account ACL qualification is separate.
