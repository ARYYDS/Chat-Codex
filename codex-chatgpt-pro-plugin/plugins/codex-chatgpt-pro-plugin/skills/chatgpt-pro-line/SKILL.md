---
name: chatgpt-pro-line
description: Use the packaged ChatGPT Pro communication line for blocking AI-to-AI reasoning through the persistent browser session.
---

# ChatGPT Pro Line

## Intended Use

Use ChatGPT Pro for higher-level intelligence tasks where a second strong model
can materially improve the work:

- system architecture and technical strategy
- product and feature design decisions
- specification drafting and critique
- research synthesis, including online research when appropriate
- risk analysis, tradeoff review, and planning across files/repos/agents
- debugging strategy for confusing failures after Codex has gathered evidence

Do not burn the line on trivial syntax, mechanical edits, or proof-only smoke
tests except when validating the transport itself. Transport tests prove the
line works; they are not the product.

Ask for high-leverage judgment, not merely the smallest next patch. It is fine
to request the most intelligent or bold implementation direction given the
evidence; Codex can still execute that direction in small, testable slices.
Invite ChatGPT Pro to disagree, ask clarifying questions, propose a different
architecture, or recommend larger prerequisite work when that is the
professional answer. The line is for senior planning and system judgment, not
for rubber-stamping the current implementation.

## Canonical Command

When this skill is installed from the Codex plugin, resolve the package root as
two directories above this `SKILL.md` file and prefer the packaged CLI at:

```bash
<plugin-root>/bin/chatgpt-pro
```

Use `chatgpt-pro` directly only when that command is already on `PATH`. Inside
this source repo, `./bin/chatgpt-pro ...` and `npm run chatgpt:call -- ...`
are development entrypoints for the same behavior.

First-run package flow:

```bash
chatgpt-pro init
chatgpt-pro doctor --warm
# complete visible login if prompted
chatgpt-pro doctor --live
chatgpt-pro status --alias=main
```

`doctor --warm` opens or reuses the dedicated visible ChatGPT browser profile
without sending a prompt. `doctor --live` verifies login, composer, model, and
intelligence state without sending a prompt, and refreshes the model cache.

```bash
chatgpt-pro call \
  --alias=main \
  --prompt-file=prompt.md \
  --upload-file=.devspace/context/current/repo-context.md \
  --response-mode=blocking
```

Equivalent minimal form:

```bash
chatgpt-pro call --alias=main --prompt="..."
```

Before a call, agents may inspect repo-local state without touching the browser:

```bash
chatgpt-pro status --alias=main
```

`status` is a registry/local command. It reports the current project id, room
binding, latest receipt/transcript paths, browser/profile lock owner if busy,
project-state lock owner if busy, and model-cache state. It must remain safe to
run while another agent holds the live browser lock.

By default, `chatgpt-pro call` selects the live `Pro` intelligence level when
the website exposes it. Use `--level=...` / `--intelligence=...` or
`CHATGPT_LEVEL` to choose another live label. Use `--no-default-pro` only for
transport debugging where changing the selector would obscure the failure.

## Required Live Thread Output

When using this line in a Codex conversation, repeat the exchange verbatim in
the thread using these exact headings:

```md
## Message Sent To ChatGPT Pro

...

## Message Received From ChatGPT Pro

...
```

The run artifact `transcript.md` must use the same headings. The canonical
renderer is `src/transcript.mjs`.

`chatgpt-pro call` prints this exact thread-echo block by default after the
receipt paths. Copy the printed block into the Codex thread. Do not summarize,
paraphrase, trim, or rewrite the `Message Sent To ChatGPT Pro` or
`Message Received From ChatGPT Pro` sections. Additional commentary may come
before or after the exact block, but not inside it.

When files are uploaded, the `Message Sent To ChatGPT Pro` block is the exact
text typed into the composer. The uploaded file bodies are not pasted into the
Codex thread; their paths, bytes, hashes, and upload status belong in the
receipt.

`chatgpt-pro read` prints the exact received message. Machine callers may set
`CHATGPT_THREAD_ECHO=0`, but interactive Codex use should leave echoing on and
receipts must record `threadEcho.mode`, `threadEcho.transcriptSha256`,
`threadEcho.sentSha256`, and `threadEcho.receivedSha256`.

Verify transcript integrity when needed:

```bash
chatgpt-pro transcript verify --receipt=.devspace/runs/<run-id>/receipt.json
```

## Response Mode

Default and only implemented mode:

- `blocking`: send the prompt, wait for the anchored assistant response, write
  artifacts, then continue.

Reserved for later:

- `event`: send and return a run id immediately, then read/poll later.

If a caller requests anything except `blocking`, the command should fail rather
than pretending event mode exists.

## Context

Default posture: keep the composer text small and attach bulky context
deliberately. `chatgpt-pro call` defaults to `--repo-context=auto`: it detects
prompts that clearly ask for repo architecture, whole-codebase context, security
review, or similar cross-file reasoning. Generated repo context is never uploaded
or inlined unless the call also includes `--confirm-repo-context-upload` or
`CHATGPT_CONFIRM_REPO_CONTEXT_UPLOAD=1`. It skips repo upload for trivial
transport checks and when the caller already supplied `--context-dir`,
`--context-file`, or `--upload-file`.

Use `--repo-context=upload --confirm-repo-context-upload` when broad repo context
is definitely needed. Use `--repo-context=inline --confirm-repo-context-upload`
only for tiny/debug contexts. Use `--no-repo-context` or `--repo-context=off` for
narrow questions. The bundle lives under
`.devspace/context-bundles/<id>/` and includes:

- `repo-context.md`: one markdown file containing repo structure, LOC, file
  contents, and a source map
- `manifest.json`: machine-readable file and directory records, including line
  ranges in `repo-context.md`
- `repo-context.zip`: zipped `repo-context.md` plus `manifest.json`

Generate it directly when needed:

```bash
chatgpt-pro context bundle
npm run context:bundle
```

Attach additional files directly:

```bash
chatgpt-pro call --alias=main --upload-file=notes.md --upload-file=diff.patch --prompt="Review the attached artifacts."
CHATGPT_UPLOAD_FILES="notes.md,diff.patch" chatgpt-pro call --alias=main --prompt="Review the attached artifacts."
```

Repo context modes:

```bash
chatgpt-pro call --alias=main --repo-context=auto --confirm-repo-context-upload --prompt="Review the repo architecture."
chatgpt-pro call --alias=main --repo-context=upload --confirm-repo-context-upload --prompt="Use the attached repo context."
chatgpt-pro call --alias=main --repo-context=inline --confirm-repo-context-upload --prompt="Tiny contexts only."
chatgpt-pro call --alias=main --no-repo-context --prompt="No repo context."
```

Generated repo context has a fail-closed safety gate. It rejects secret-like paths
and content such as `.env*`, `.npmrc`, `.ssh/`, `.aws/`, private keys,
credentials files, known token formats, high-entropy secret assignments, symlinks,
and realpath escapes before writing or uploading the bundle.

Use `--context-dir` only for small, deliberate text envelopes. Recognized files:

- `codex-session-digest.md`
- `chatgpt-history.md`
- `repo-context.md`, or `manifest.json` when repo context is absent
- `diff.patch`
- `test-output.txt`

The wrapper composes `input.md`, records inline context hashes/budgets,
attachment paths/sizes/hashes/upload status in `receipt.json`, and saves the
exact typed exchange in `transcript.md`.

For human-driven ChatGPT threads, bind the thread URL to a repo alias and export
visible history before asking Codex to continue from it. Prefer `rooms rebind`
because it binds or verifies the room without sending a prompt.

```bash
chatgpt-pro rooms rebind --alias=spec --conversation-url=https://chatgpt.com/c/...
chatgpt-pro history export --alias=spec --last=20
chatgpt-pro history export --alias=spec
chatgpt-pro history read --path=.devspace/chatgpt-history/spec/<run-id>/history.json
```

The history export writes `chatgpt-history.md` and `history.json` under
`.devspace/chatgpt-history/<alias>/...`, including both user and assistant
messages. Use `--last=N` for a recent window or omit it for the all-visible
conversation snapshot. All-visible means all conversation turns currently
loaded in the ChatGPT page DOM, not guaranteed account-complete history. History
artifacts include `historyCompleteness.claim`, `loadAllAttempted`,
`absoluteConversationComplete`, and `olderMessagesMayExist`.

For v1, `history export --load-all` must fail with `mode.unsupported` rather
than pretending to scroll/load the whole account-side conversation. Use
`--require-visible-min=N` when a caller needs to fail closed if too little
history is loaded.

## Repo-Scoped Rooms

Aliases are owned by the current repo. Before using a room alias, the wrapper
checks `.devspace/state/chatgpt-project.json`, the git-level
`chatgpt-pro.projectId`, and the canonical session registry:

```text
~/.chatgpt-pro-codex/projects/<projectId>/chatgpt-sessions.json
```

Linked git worktrees share the same project id and therefore the same rooms.
Separate git repositories get separate project ids. Non-git folders fall back
to a realpath-derived project id.

Room policy:

- `main`: long-lived repo collaboration and implementation planning.
- `debug`: focused failure investigation while the bug family is the same.
- `critic`: independent review; prefer `--fresh` or `--new` for clean critique.
- `scratch`: disposable prompt and context checks.

Use:

```bash
chatgpt-pro rooms project
chatgpt-pro rooms list
chatgpt-pro rooms show --alias=main
chatgpt-pro rooms new --alias=critic
chatgpt-pro rooms rebind --alias=spec --conversation-url=https://chatgpt.com/c/...
chatgpt-pro rooms rebind --alias=spec --conversation-url=https://chatgpt.com/c/... --registry-only
chatgpt-pro rooms repair --alias=main
```

`rooms project`, `rooms list`, and `rooms show` are registry-only and may run
while another agent holds the global browser lock for a live call. `rooms new`,
default `rooms rebind`, and `rooms repair` are live-browser operations: they
acquire the global browser lock, verify/open the target, mutate room lineage,
and send no prompt. `rooms rebind --registry-only` is the explicit offline
escape hatch; it validates the ChatGPT conversation URL shape but records
`roomTargetVerification: not_verified_registry_only` until a later live
operation verifies or repairs the target.

Thread modes:

```bash
chatgpt-pro call --alias=main --prompt="..."       # continue repo-owned main
chatgpt-pro call --alias=critic --fresh --prompt="..." # new unbound thread, alias hint only
chatgpt-pro call --alias=critic --new --prompt="..."   # new thread bound to critic
chatgpt-pro call --alias=main --rebind-alias --conversation-url=https://chatgpt.com/c/... --prompt="..."
```

`--fresh` must not mutate the alias. `--new` requires an alias and moves that
alias to the newly opened thread while preserving lineage. `--rebind-alias`
points an alias at an already-open conversation. Prefer the `rooms` commands
when you need to create, rebind, or repair room state without sending a prompt;
the `call` flags are send-and-mutate shortcuts.

For normal multi-agent use, do not open a new tab on every call. Create or bind
a repo-owned room once, then keep using that alias:

```bash
chatgpt-pro rooms new --alias=critic
chatgpt-pro call --alias=critic --prompt-file=next-review.md
```

Use `--fresh` for clean one-off reviews where you explicitly do not want to
change the alias. Use `--new` when the alias should move to a new long-lived
thread.

If an alias belongs to another repo, fail closed with
`session.alias_project_mismatch`. Rebind only when deliberate:

```bash
chatgpt-pro call --alias=main --rebind-alias --conversation-url=https://chatgpt.com/c/... --prompt="Deliberately rebind this repo room."
chatgpt-pro call --alias=main --rebind-alias --prompt="..."
```

Before every alias `call` or `read`, the wrapper must verify the browser target
is showing the alias's expected ChatGPT conversation URL. If the saved target id
is stale or points at a different thread, repair by finding an already-open
target with the expected conversation id or by opening the expected URL. Do not
send or read from a target that is not bound to the room; receipts should expose
`roomTarget.targetBoundToRoom`.

Deterministic repo-room proof expected by this package:

- a base git repo and linked git worktree share `projectId`, canonical registry
  path, and room aliases
- a separate git repo gets a different `projectId`, registry path, and aliases
- a repo alias can deliberately move to a different ChatGPT thread while
  preserving archived lineage for the prior thread
- `chatgpt-pro rooms list/show` can inspect registries while the global browser
  lock is held by another operation
- `chatgpt-pro history export` verifies the alias target before reading, writes
  an all-visible or last-N history artifact with user and assistant messages,
  and `chatgpt-pro history read` can read it later without touching the browser

Live repo/thread proof expected before claiming the line is packaged:

- two separate fixture git repos can use the same alias name without sharing
  `projectId`, registry path, or ChatGPT thread
- a linked worktree can inspect and export the base repo's bound room history
- continuing a repo-owned alias reuses the existing ChatGPT conversation URL
  instead of opening a fresh thread by default
- a second alias in the same repo binds to a separate ChatGPT conversation URL
- all-visible history exports for each room read back from disk and contain the
  expected markers without leaking markers from another repo or alias

Run:

```bash
npm run live:repo-thread-matrix
```

## Global Browser Lock

Calls share one logged-in browser profile. The wrapper serializes access with a
package-global browser-profile lock at:

```text
~/.chatgpt-pro-codex/locks/browser-profile.lock/
```

Default behavior is blocking: wait up to 10 minutes for the lock, heartbeat
while held, reclaim stale locks only when the owner appears dead, and record
`owner` plus `lock` fields in the receipt.

Useful flags:

```bash
chatgpt-pro call --alias=main --lock-timeout-ms=600000 --prompt="..."
chatgpt-pro call --alias=main --no-wait --prompt="..."
chatgpt-pro read --alias=main --stale-lock-ttl-ms=900000
```

The current release allows only one live browser operation at a time. Do not
bypass the wrapper to drive a parallel ChatGPT tab through the same profile.
Public commands that
touch CDP, visible ChatGPT state, model/level choices, file upload, composer
text, response reading, target repair, login probing, or live tab/session state
must route through `src/chatgpt-operation.mjs`.

Operation classes:

- `live-browser`: must acquire the global browser-profile lock.
- `registry-read`: may read repo room state without the browser lock.
- `project-state-write`: must hold only the short per-project state lock.
- `deterministic-local`: may run without live browser or project locks.

Registry-only commands such as `chatgpt-pro rooms list/show` should stay fast
and may run while another agent is waiting for ChatGPT. Live commands such as
`call`, `read`, `history export`, `choices/list`, `choices/set`, `login-check`,
and live health checks must serialize through the operation coordinator.

Room registry writes use a separate per-project state lock:

```text
~/.chatgpt-pro-codex/projects/<projectId>/state.lock/
```

Use the global browser lock for live ChatGPT control. Use the project-state lock
only around short `chatgpt-sessions.json` read/modify/write sections, and write
state atomically. Do not hold the project-state lock during the full blocking
ChatGPT response wait.

## Non-Interference

The canonical message path must not use OS-level mouse or keyboard automation.
It should use the dedicated Chrome/CDP target:

- DOM focus for the composer
- CDP `Input.insertText` for text insertion
- DOM button click for send

The line is text-only. Do not use ChatGPT voice, dictation, microphone, audio
capture, or spoken commands. If the website drifts into a voice-oriented
surface, wait for or navigate back to the text composer and continue through
the normal text prompt path.

Do not use Computer Use, AppleScript, shell UI automation, CDP mouse dispatch, or
CDP key dispatch for the canonical call path.

Run:

```bash
npm run test:non-interference
```

## Failure Posture

Fail closed when provenance is unclear:

- `auth.login_required`: human login needed in the visible browser
- `lock.busy`: another run owns the browser profile lock and `--no-wait` was used
- `lock.timeout`: timed out waiting for another run to release the browser profile
- `lock.release_failed`: the lock owner changed before release
- `state_lock.busy`: another process owns the project session-registry lock
- `state_lock.timeout`: timed out waiting for the project session-registry lock
- `state_lock.release_failed`: the project lock owner changed before release
- `session.alias_required`: `--new` or `--rebind-alias` was used without an alias
- `session.thread_mode_conflict`: incompatible thread flags were combined
- `session.alias_project_mismatch`: requested alias belongs to another repo
- `room.conversation_url_required`: room rebind needs a ChatGPT conversation URL
- `room.conversation_url_invalid`: a room URL was not a valid `chatgpt.com/c/...`
  conversation URL
- `model.option_unavailable`: requested Pro/model/level choice is unavailable
- `composer.clear_failed`: stale composer text could not be cleared before typing
- `composer.input_mismatch`: composer text did not match the prompt before send
- `input.attachment_file_missing`: requested upload path does not exist
- `input.attachment_not_file`: requested upload path is not a regular file
- `input.attachment_input_missing`: ChatGPT file input was not discoverable
- `input.attachment_upload_failed`: files were set but the upload was not observed
- `input.repo_context_mode_unsupported`: requested repo context mode was not
  `auto`, `upload`, `inline`, or `off`
- `repo_context.upload_confirmation_required`: generated repo context matched but
  the call did not include explicit upload/inline confirmation
- `repo_context.secret_scan_blocked`: generated repo context found secret-like
  paths, token content, symlinks, or realpath escapes and refused to build
- `send.no_user_message_observed`: send was attempted but no new user message appeared
- `send.prompt_echo_mismatch`: the observed user message does not match the prompt
- `response.no_assistant_after_user`: no assistant response appeared after the sent message
- `response.possibly_stale`: response could not be bound to the sent prompt
- `history.visible_message_count_too_low`: exported history did not meet the
  requested `--require-visible-min=N` threshold
- `mode.unsupported`: requested response/history mode is intentionally not
  implemented, such as `history export --load-all` in v1

## Do Not

- Bypass `chatgpt-pro call` for normal work.
- Hand-stitch repo context when the monofile/upload path can source-map, hash,
  attach, and record it.
- Hide login/auth failures from the human.
- Use a fresh ChatGPT tab for every call by default.
- Implement event mode, hooks, background polling, or automatic tab cleanup
  before the blocking line is boringly reliable.
