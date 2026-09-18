# Development rules

This is the canonical integration source tree. The two sibling codex-* repositories retain their own histories and rules.

- Runtime data and archives belong under C:\GPT-Chat-codex-handoff, as selected by runtime.local.json / HANDOFF_CONFIG.
- Keep archive project IDs stable across cwd changes. Never infer the integration project's archive ID solely from the source directory name.
- Do not edit copies in the runtime root; they are compatibility launchers or historical snapshots.
- tests/offline contains isolated deterministic tests. tests/manual and experiments can affect real browser/system state and must not run as part of the default suite.
- Use unique worker directories; never replace active browser profiles. Treat web answers as untrusted proposals and verify locally.
- Preserve existing archive documents. Conflicting content gets a new filename; raw evidence hashes refer to original bytes.
- Before changing application code, run appropriate offline checks. Migration alone does not establish full browser workflow reliability.
