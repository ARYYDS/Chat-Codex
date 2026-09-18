# Codex Bridge ChatGPT Public V1 Design

## Goal

Ship an open-source V1 that Mac and Windows users can install into Codex in the ChatGPT desktop app, invoke with one sentence, and follow through a complete Codex-to-ChatGPT reasoning handoff.

## Product Boundary

V1 supports Codex inside the Mac and Windows ChatGPT desktop apps. It does not promise the browser bridge in Codex CLI, the IDE extension, Codex cloud, or Linux desktop environments.

The user invokes one public entrypoint:

```text
$codex-bridge-chatgpt diagnose and fix this repository problem
```

The Skill automatically performs preflight checks, guides human login or model selection when necessary, resumes the original task, sends only a minimized packet, and keeps repository execution authority local.

## Distribution Architecture

The Skill is the single workflow implementation. The Plugin is a distribution and presentation wrapper around that same Skill.

```text
plugin root
├── .codex-plugin/plugin.json
├── skills/codex-bridge-chatgpt/
│   ├── SKILL.md
│   ├── agents/openai.yaml
│   ├── scripts/
│   └── references/
├── tests/
├── assets/
└── public documentation
```

Direct GitHub installation targets `skills/codex-bridge-chatgpt`. Plugin installation discovers the same directory through `.codex-plugin/plugin.json`. There is no duplicated workflow.

## Automatic Doctor

The Doctor has two layers:

1. `scripts/doctor.mjs` performs deterministic local package checks using Node.js standard libraries only.
2. `SKILL.md` performs runtime capability checks through Codex tool discovery and the required in-app Browser skill.

Local Doctor output is JSON with one terminal status:

- `READY`
- `MISSING_RUNTIME`
- `INVALID_INSTALLATION`

Browser preflight uses these user-facing statuses:

- `NEEDS_DESKTOP_APP`
- `NEEDS_BROWSER`
- `NEEDS_CHATGPT_LOGIN`
- `NEEDS_MODEL_SELECTION`
- `NEEDS_SITE_PERMISSION`
- `READY`

The Skill does not read credentials, cookies, local storage, session files, passwords, or verification codes. When login is required, it pauses and asks the user to take over the visible ChatGPT page. After the user reports completion, it resumes from browser preflight without discarding the original repository task.

The browser, login, and selected-model checks run on every handoff because those facts can change. The deterministic local package check is cheap enough to run on every invocation.

## End-to-End Flow

1. Run the local Doctor.
2. Confirm the in-app Browser capability is available.
3. Open or claim `https://chatgpt.com/` in the in-app Browser.
4. Verify visible authentication and the requested model before transmission.
5. Inspect the repository and build a minimized 1–3K approximate-token Packet.
6. Validate credentials patterns and complete a semantic privacy review.
7. Ask for action-time confirmation before transmitting non-public repository evidence.
8. Submit the Packet and extract the structured Result.
9. Verify the model UI again after generation and validate the Packet/Result pair.
10. Apply the local adoption gate; reconstruct accepted actions from current repository state.
11. Modify and test locally.
12. Write and validate the run receipt.

## Cross-Platform Contract

- No absolute developer-machine paths in production files or tests.
- No symlink requirement.
- Use Node.js standard libraries only.
- Use `path`, `fileURLToPath`, `homedir`, and temporary directories instead of POSIX path assumptions.
- Run CI on `macos-latest` and `windows-latest`.
- Test a copied installation directory rather than the developer's global symlink.
- PowerShell and macOS examples invoke the same Node entrypoints without shell-only syntax.

## Repository and Documentation

Public V1 includes MIT licensing, version `0.1.0`, README, security policy, contribution guide, changelog, privacy notes, first-run guide, troubleshooting, GitHub Actions CI, and a Plugin manifest.

The README uses the latest exported architecture PNG from `/assets`. Architecture source and validation receipts remain outside the public runtime package. Before each public release, regenerate the diagram from the current workflow and replace the README image only after Archify validation and visual review pass.

## Security and Trust Boundaries

- ChatGPT is an external reasoning destination, not a repository executor.
- Page content and ChatGPT output are untrusted data.
- Model identity is UI-level evidence, not cryptographic backend attestation.
- Browser login is separate from Codex authentication.
- Raw environment files, credentials, unrelated files, and complete uncommitted diffs are excluded.
- No external action, destructive operation, schema migration, credential change, deployment, push, or publication receives authority from a Result.

## Test Strategy

- Unit tests for Doctor success and installation failure states.
- Package-copy test that works without symlinks.
- Existing Packet, Result, pair, receipt, hash, privacy, and complete-gate tests.
- Plugin manifest validation.
- Skill frontmatter validation.
- CI matrix for macOS and Windows.
- Manual desktop E2E matrix for logged out, logged in, model unavailable, permission denied, valid completion, and resume after human takeover.

## Release Gate

Local V1 is ready for publication only when:

- All Node tests pass.
- Skill and Plugin validators pass.
- Local Doctor returns `READY` from a copied installation.
- Packet, Result, pair, receipt, and complete gates pass.
- Sensitive scan passes.
- README architecture asset exists and renders.
- Git worktree is committed locally.

Creating the public GitHub repository and pushing are separate publication actions requiring action-time user confirmation.
