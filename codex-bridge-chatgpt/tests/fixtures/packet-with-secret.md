BEGIN_CONTEXT_PACKET
packet_id: unsafe
requested_reasoner: GPT-5.6 Sol

## Objective
Validate redaction.

## Acceptance
- Reject leaked credentials.

## Repository State
- Dirty.

## Evidence
OPENAI_API_KEY=[INJECTED_BY_TEST]

## Constraints
- Do not leak secrets.

## Questions
1. Is this safe?
END_CONTEXT_PACKET
