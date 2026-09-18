BEGIN_REASONING_RESULT
packet_id: smoke-2026-08-30

## Verdict
Use a contract-first Skill with one local validator.

## Assumptions
- Browser authentication and model selection are runtime facts.

## Evidence Used
- The packet states that browser text exchange works.

## Proposed Changes
1. Add a concise Skill entrypoint.
2. Add packet and result contracts.
3. Validate before and after browser reasoning.

## Tests
- Validate safe and unsafe fixtures.
- Run one real browser round trip.

## Risks
- The web model can hallucinate repository facts.
- Logged-out ChatGPT does not prove GPT-5.6 Sol usage.

## Unknowns
- The authenticated account's model selector is not visible in this run.
END_REASONING_RESULT
