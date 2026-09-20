# Local-only runtime contract

Sunny requires Ollama /api/status to explicitly report cloud.disabled=true before
model discovery and before any conversation is transmitted. Localhost alone is
insufficient because an Ollama daemon can proxy cloud models. Missing, unsupported,
malformed, oversized, failed, or enabled policy responses deny inference. Every
request rechecks policy; there is no paid fallback or retry. Existing local-model
name and metadata restrictions remain. STOP cancels pending policy checks.

The upstream experimental status contract is documented in Ollama api/types.go and
api/client.go. The supported cloud-disable setting is described at
https://docs.ollama.com/faq. This adapter trusts the local daemon; the check is not
OS-level egress containment or protection against a daemon replacement race.

All JSON responses identify service=paradize-sunny-local, protocolVersion=2,
localOnlyPolicyRequired=true, provider=ollama, and paidRequestsEnabled=false.
The Windows launcher checks exact types, version, and recognized health states.
It refuses to launch the island against an older or unrecognized bridge and does
not automatically kill existing processes. Unavailable and stopped states can
identify a compatible bridge without promising model readiness.

Unity checks the same compatibility fields on conversation, health, control, and
knowledge-search responses. Preserved-source binary downloads retain their existing
owner and hash checks. Version fields are compatibility metadata, not executable
attestation. Unity JsonUtility behavior and live reconnect still need player testing.

Validation commands:
- node --test services/sunny-local/*.test.mjs
- powershell.exe -NoProfile -File tests/unity/verify-sunny-health-contract.ps1
- powershell.exe -NoProfile -File tests/unity/verify-bridge-contract.ps1
- powershell.exe -NoProfile -File tests/unity/verify-source-copies.ps1

The dedicated local-only daemon, launcher lifecycle, rebuilt player, live reconnect,
and broader zero-paid system journeys are not yet qualified. Start-Paradize.ps1
still targets shared loopback port 11434; do not assume an existing daemon is local-only
or change shared configuration silently. These changes update source, not an installed
release. Existing deployments require a coordinated service/client update.
