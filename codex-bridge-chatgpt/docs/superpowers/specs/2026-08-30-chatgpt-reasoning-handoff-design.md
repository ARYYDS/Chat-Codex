# ChatGPT Reasoning Handoff Design

## Goal

Let an efficient Codex model retain repository access and execution control while delegating only bounded, high-cost reasoning to a model visibly available in ChatGPT's web interface.

## Architecture

The workflow has two trust domains:

1. **Local executor:** reads repository instructions and code, searches, redacts, validates, edits, and tests.
2. **Web reasoner:** receives a 1–3K approximate-token packet and returns a proposal. It never receives repository access or execution authority.

The bridge is two structured Markdown contracts. Markdown is used because it survives browser input/output and remains human-auditable. A dependency-free Node validator rejects missing sections, oversized packets, and common credential patterns.

## Data Flow

`local evidence -> sanitized Context Packet -> ChatGPT -> Reasoning Result -> local verification -> edit -> test`

The packet carries objective, acceptance criteria, repository state, evidence, constraints, and focused questions. The result carries verdict, assumptions, evidence used, proposed changes, tests, risks, and unknowns. `packet_id` ties both halves together.

## Model and Account Boundary

The requested model is a runtime requirement, not a fact encoded by the Skill. Codex must inspect the visible model selector after authentication. If the requested model cannot be proven, it stops or uses a fallback only when the user explicitly allows one. The workflow never bypasses account entitlements.

## Safety and Correctness

- Send the smallest useful packet; exclude secrets, personal data, environment files, and unrelated code.
- Treat ChatGPT output as untrusted advice. Re-open every referenced file and verify claims locally.
- Preserve dirty worktrees and repository instructions.
- Require existing action-time approvals for destructive, external, schema, deployment, and credential changes.
- Use browser automation for transport, not for editing the repository.

## Acceptance

- The validator fails before implementation and passes after implementation.
- A real in-app-browser round trip returns a contract-valid result.
- The run reports model/account verification separately from transport success.
- No global dependency, API key, push, deployment, or publication is required.
