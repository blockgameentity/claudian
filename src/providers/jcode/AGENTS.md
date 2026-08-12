# Jcode Provider

`src/providers/jcode/` adapts Jcode through Agent Client Protocol over a `jcode acp` subprocess.

## Dependency Boundary

- ACP transport, session, and interaction mechanics are shared via `src/providers/acp/`. Jcode launch artifacts, session semantics, history JSON format, tools, commands, and metadata policy remain provider-owned.
- Jcode's own home directory (`~/.jcode` or `JCODE_HOME`) and native session JSON files remain outside Claudian ownership and are always read-only.

## Ownership

| Component or area | Owns |
| --- | --- |
| `JcodeExecutionSession` | Provider execution binding, request lifecycle, normalized events, command/config-option notification capture, and session-missing recovery |
| `JcodeAcpSessionKernel` | Managed ACP process, native session load/resume, config options, file requests, and working-directory enforcement |
| `JcodeMetadataService` | Detached model and command metadata probes plus model catalog discovery |
| `history/` | Read-only session JSON hydration, replay projection, and historical model recovery |
| `runtime/` | Path resolution, CLI resolution, environment construction, and prompt building |
| `JcodeCommandCatalog` + `app/JcodeCommandLoader` | Runtime command and skill discovery from ACP notifications |

## Protocol Rules

- Live output comes from ACP session notifications and is normalized through `AcpSessionUpdateNormalizer` plus `jcodeToolNormalization`.
- History hydration reads Jcode's native session JSON files (`sessions/session_*.json`) from the trusted `~/.jcode` or `JCODE_HOME` location.
- Historical selected-model recovery reads the session header's model ID. Preserve the raw historical selection even when it is no longer in the current model catalog, and never promote a recovery-only locator into a live ACP binding.
- `providerState.sessionsDirPath` preserves the sessions directory used for a conversation until a typed history or environment transition replaces it. Keep it when building session updates.
- File requests are resolved and permission-checked against the kernel's configured vault working directory; do not recreate path policy in feature code.

## Launch and Settings

- Launch args: `jcode acp --no-update --no-selfdev --cwd=<vault path>`.
- Jcode model IDs may be `provider/model` style and are surfaced through `models.ts` (`jcode:` encoded selection IDs, thinking-level variants).
- Reasoning is controlled per model through thinking levels (`none`..`xhigh`); `effortLevel` stores the active level, `preferredThinkingByModel` the per-model default.
- Runtime fingerprint changes invalidate Jcode sessions. The fingerprint includes `JCODE_HOME`, `JCODE_RUNTIME_DIR`, `PATH`, and explicit/host CLI-path inputs.
- Treat persisted provider configuration as untrusted: `settings.ts` normalization must decode every field and fail closed on invalid tool, permission, and model settings.

## Commands

- Runtime commands are read from the ACP `commands` notification and exposed through `JcodeCommandCatalog`.
- Command discovery warmup for blank tabs runs an isolated ACP probe and must not create a persisted conversation session.
- Do not let command discovery create a real session for history-backed conversations that have messages but no provider session yet.

## Gotchas

- File read/write permission requests may target paths outside the session working directory. Preserve the existing approval mapping and path checks.
- Session JSON message blocks include `text`, `image`, `tool_use`, `tool_result`, and `reasoning`; hydration must map them to core `ChatMessage` shapes including images, tool results with diff data, and AskUserQuestion answers.
- A session file missing or unreadable must produce a diagnostic message, never a crash or a silently empty conversation.
