# Context Packet Contract

Use this exact order and markers:

```markdown
BEGIN_CONTEXT_PACKET
packet_id: <unique-local-id>
requested_reasoner: <visible model required by the user>

## Objective
<one decision or problem>

## Acceptance
- <observable outcome>

## Repository State
- <branch, dirty state, relevant runtime facts>

## Evidence
- <file:symbol or command result plus concise fact>

## Constraints
- <compatibility, scope, approval, privacy boundaries>

## Questions
1. <focused question for deep reasoning>
END_CONTEXT_PACKET
```

Prioritize objective, acceptance, decisive evidence, and constraints. Remove history and implementation detail that do not change the decision. Keep paths and symbols when they let Codex verify the answer later. Mark unavailable facts as unknown; do not infer them.

Target 1–3K approximate tokens. A smaller packet is valid when complete. Split unrelated decisions into separate handoffs rather than exceeding 3K.
