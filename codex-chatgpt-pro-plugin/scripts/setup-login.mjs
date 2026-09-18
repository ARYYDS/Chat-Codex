import { launchChrome, waitForCdp } from "../src/chrome-session.mjs";
import {
  DEFAULT_CDP_PORT,
  DEFAULT_TARGET_URL,
  profilePath,
} from "../src/runtime-config.mjs";

const port = Number(process.env.CHROME_REMOTE_DEBUGGING_PORT || DEFAULT_CDP_PORT);
const target = process.env.BROWSER_TARGET_URL || DEFAULT_TARGET_URL;
const profileName = process.env.BROWSER_PROFILE_NAME || "chatgpt-pro";
const userDataDir = profilePath(profileName);
let reused = false;

try {
  await waitForCdp(port, 500);
  reused = true;
} catch {
  await launchChrome({
    port,
    userDataDir,
    startUrl: target,
    appWindow: false,
    headless: false,
    detached: true,
  });
}

console.log(
  [
    reused
      ? `Chrome CDP is already running at http://127.0.0.1:${port}.`
      : `Opened Chrome at ${target}.`,
    `Profile: ${userDataDir}`,
    "",
    "Setup flow:",
    "1. Complete ChatGPT login in the visible Chrome window if prompted.",
    "2. Run npm run login:check.",
    "3. Run BROWSER_OBSERVER=1 npm run live:chatgpt.",
    "",
    "Automation must not enter passwords, OTPs, solve CAPTCHA, or inspect cookies/session storage.",
  ].join("\n"),
);
