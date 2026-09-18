import { buildChatGptStatus } from "../src/chatgpt-status.mjs";

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const alias = arg("alias") || arg("session") || process.env.CHATGPT_SESSION || "main";

try {
  if (process.argv.includes("--live")) {
    const error = new Error("status --live is not implemented yet. Use chatgpt-pro doctor --live once package-shell doctor lands.");
    error.errorCode = "mode.unsupported";
    throw error;
  }
  console.log(JSON.stringify(buildChatGptStatus({ alias }), null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    command: "status",
    errorCode: error?.errorCode || "status.failed",
    error: String(error?.message || error),
  }, null, 2));
  process.exit(1);
}
