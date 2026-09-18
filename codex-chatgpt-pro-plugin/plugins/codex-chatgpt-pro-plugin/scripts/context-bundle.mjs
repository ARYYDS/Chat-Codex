import { buildRepoContextBundle } from "../src/repo-context-bundle.mjs";

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

try {
  const result = buildRepoContextBundle({ name: arg("name") });
  console.log(JSON.stringify({ ok: true, result }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    errorCode: "context.bundle_failed",
    error: String(error?.message || error),
  }, null, 2));
  process.exit(1);
}
