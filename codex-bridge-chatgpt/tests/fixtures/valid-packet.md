BEGIN_CONTEXT_PACKET
packet_id: smoke-2026-08-30
requested_reasoner: GPT-5.6 Sol

## Objective
Decide the smallest safe design for a Codex-to-ChatGPT reasoning handoff.

## Acceptance
- Packet remains below 3000 approximate tokens.
- ChatGPT returns the required result contract.
- Codex verifies every proposal before editing.

## Repository State
- New standalone skill directory.
- No production deployment or remote write is authorized.

## Evidence
- The in-app browser can open ChatGPT and exchange text.
- The current browser session is not logged in, so the selected model is unverified.

## Constraints
- No credentials or unrelated private source may leave the machine.
- Preserve dirty worktrees and obey repository instructions.
- Use the in-app browser requested by the user.

## Questions
1. What contract keeps the handoff deterministic without overbuilding a platform?
2. What must Codex verify before applying the proposed changes?
END_CONTEXT_PACKET
