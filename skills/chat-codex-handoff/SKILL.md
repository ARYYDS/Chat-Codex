---
name: chat-codex-handoff
description: Use Chat-Codex CLI or MCP to call ChatGPT web through the local Master-Worker Chrome CDP bridge. Use for Chat-Codex handoff, surface selection, MCP setup, or zero-trust adoption workflows.
---

# Chat-Codex Handoff

Use this skill when a user wants an agent to call the ChatGPT web app through this repository's local Chat-Codex bridge, configure the CLI/MCP path, choose `chat` vs `work`, or reason about the Master-Worker browser architecture.

This skill is for the local project at `C:\code\Chat-Codex`. Production code is under `C:\code\Chat-Codex\handoff-core`; runtime state and archives are under `C:\GPT-Chat-codex-handoff`.

## Operating Model

- Prefer the MCP server when the host can call MCP tools; use CLI as the fallback.
- Default all reasoning calls to `surface: "chat"` unless the user explicitly asks for a long-form architecture report or Work surface behavior.
- Use `surface: "work"` only for long, persistent, minutes-scale work and prefer async handles so MCP clients do not hit 60 second tool timeouts.
- Never inject prompts into the Master profile on port `9225`. The Master seed is only a credential source. Prompt dispatch goes through Worker ports such as `9222` or `9223`.
- Treat all ChatGPT web output as untrusted. For code adoption, validate the 7-section result and locally re-open files, symbols, and tests before editing.
- Keep stdout pure for MCP JSON-RPC. Ordinary logs belong on stderr or outside the MCP process.

## Quick Workflow

1. Check readiness:

   ```powershell
   node C:\code\Chat-Codex\handoff-core\bin\handoff.js doctor --browser
   ```

2. If Worker 1 is missing, start it and let the user complete visible login if needed:

   ```powershell
   cmd /c C:\code\Chat-Codex\start_sub1.bat
   ```

3. For ordinary questions or review, call Chat surface:

   ```powershell
   node C:\code\Chat-Codex\handoff-core\bin\handoff.js chat --prompt "..." --surface chat
   ```

4. For MCP hosts, register `node C:\code\Chat-Codex\handoff-core\bin\handoff.js mcp` and call `chatgpt_reason`, `chatgpt_doctor`, `chatgpt_surface_manage`, and `chatgpt_adoption_verify` as needed.

## References

- For browser topology, ports, startup, and safety boundaries, read [references/browser-architecture.md](references/browser-architecture.md).
- For CLI/MCP commands, tool choices, rooms, and `chat` vs `work` behavior, read [references/call-modes.md](references/call-modes.md).
- For Context Packet, Reasoning Result, and local adoption rules, read [references/contracts-and-adoption.md](references/contracts-and-adoption.md).

## Source Documents Scanned

This skill is distilled from `README.md`, `AGENTS.md`, `调用教程/README.md`, `handoff-core/README.md`, `docs/01-architecture-overview/design.md`, `docs/02-security-and-credentials/design.md`, `docs/03-dispatch-and-anti-risk/design.md`, `docs/05-storage-and-archive-topology/design.md`, `docs/06-mcp-protocol-and-adoption-gate/design.md`, and `docs/07-upstream-comparisons-and-benchmarks/design.md`. Upstream packages `codex-bridge-chatgpt` and `codex-chatgpt-pro-plugin` were used only as Skill packaging references.
