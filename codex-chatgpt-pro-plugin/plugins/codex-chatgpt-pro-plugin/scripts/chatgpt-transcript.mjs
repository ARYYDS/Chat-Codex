import { verifyRunEnvelope } from "../src/chatgpt/run-envelope.mjs";

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const command = process.argv[2] || "verify";

try {
  if (command !== "verify") throw new Error(`Unknown transcript command: ${command}`);
  const result = verifyRunEnvelope({ receiptPath: arg("receipt") || process.argv[3] || "" });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    command,
    errorCode: error?.errorCode || "transcript.verify_failed",
    ...(error?.details ? { details: error.details } : {}),
    error: String(error?.message || error),
  }, null, 2));
  process.exit(1);
}
