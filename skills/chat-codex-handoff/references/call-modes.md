# CLI And MCP Call Modes

Use this reference when choosing between CLI and MCP, configuring a host, or selecting `chat` vs `work`.

## CLI Fallback

Readiness:

```powershell
node C:\code\Chat-Codex\handoff-core\bin\handoff.js doctor --browser
```

Fast Chat call:

```powershell
node C:\code\Chat-Codex\handoff-core\bin\handoff.js chat --prompt "..." --surface chat
```

Isolated critic room:

```powershell
node C:\code\Chat-Codex\handoff-core\bin\handoff.js chat --prompt "..." --surface chat --room critic
```

GUI:

```powershell
C:\code\Chat-Codex\start_gui.bat
```

Index rebuild:

```powershell
node C:\code\Chat-Codex\handoff-core\bin\handoff.js index
```

## MCP Registration

Use the local server:

```json
{
  "mcpServers": {
    "chat-codex": {
      "command": "node",
      "args": [
        "--dns-result-order=ipv4first",
        "C:\\code\\Chat-Codex\\handoff-core\\bin\\handoff.js",
        "mcp"
      ],
      "env": {
        "NODE_OPTIONS": "--dns-result-order=ipv4first",
        "HANDOFF_CONFIG": "C:\\GPT-Chat-codex-handoff\\runtime.local.json"
      }
    }
  }
}
```

The MCP server exposes these tools:

- `chatgpt_doctor`: read-only runtime and CDP preflight.
- `chatgpt_reason`: dispatch a web reasoning task.
- `chatgpt_surface_manage`: detect/configure `chat` or `work`, model, and effort.
- `chatgpt_upload_context`: create a redacted monofile repository bundle.
- `chatgpt_session_manage`: manage semantic rooms such as `main`, `debug`, `critic`, and `scratch`.
- `chatgpt_adoption_verify`: validate structured ChatGPT output and optional patch/test gates.

It also exposes resources:

- `chatgpt://runtime/status`
- `chatgpt://sessions/rooms`
- `chatgpt://history/recent`

## Surface Selection

Use `surface: "chat"` by default.

Choose Chat when:

- The user asks a normal question, review, bug hypothesis, or small design decision.
- The answer should return in seconds.
- The task can fit in a compact prompt or Context Packet.

Choose Work only when:

- The user explicitly requests Work mode, a long architecture report, or persistent outputs.
- The answer may take minutes.
- You can use `asyncHandle: true` or a polling pattern.

Avoid Work for routine coding questions. A mistaken Work call can exceed MCP client timeouts and waste the browser line.

## Async Reasoning Pattern

For long MCP calls:

```json
{
  "action": "dispatch",
  "prompt": "...",
  "surface": "chat",
  "asyncHandle": true
}
```

Then fetch:

```json
{
  "action": "fetch_result",
  "taskId": "task_..."
}
```

If the host lacks MCP, use CLI and keep the call in `surface chat` unless the user asked otherwise.

## Rooms

Use:

- `main` for the main project thread.
- `debug` for bug investigation.
- `critic` for independent review.
- `scratch` for temporary exploration.

Prefer `critic` for architecture/security review so the history is not contaminated by implementation chatter.
