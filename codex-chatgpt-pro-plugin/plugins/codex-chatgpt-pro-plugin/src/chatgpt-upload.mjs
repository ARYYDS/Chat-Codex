import { basename, extname, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { evaluate, sleep } from "./cdp-client.mjs";

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function textSha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function uploadError(errorCode, message, details = {}) {
  const error = new Error(message);
  error.errorCode = errorCode;
  error.details = details;
  return error;
}

function utcFileStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function stampedName(name, stamp, index) {
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  const ordinal = index > 0 ? `-${index + 1}` : "";
  return `${stem}.${stamp}${ordinal}${ext}`;
}

function displayOriginalPath(path) {
  const absolute = resolve(path);
  const cwd = resolve(process.cwd());
  if (absolute === cwd || absolute.startsWith(`${cwd}${sep}`)) return relative(cwd, absolute) || basename(absolute);
  return `[outside-cwd]/${basename(absolute)}`;
}

function textUploadExtension(path) {
  return new Set([
    ".css",
    ".csv",
    ".diff",
    ".html",
    ".js",
    ".json",
    ".jsx",
    ".log",
    ".md",
    ".mjs",
    ".patch",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
  ]).has(extname(path).toLowerCase());
}

async function fileInputNodeId(cdp) {
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const selectors = [
    "#upload-files",
    "input[type='file']:not([accept='image/*'])",
    "input[type='file']",
  ];
  for (const selector of selectors) {
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (nodeId) return { nodeId, selector };
  }
  throw uploadError("input.attachment_input_missing", "No ChatGPT file input was found.", { selectors });
}

async function dismissUploadDialog(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const modalText = document.body?.innerText || "";
      if (!/already uploaded this file|try uploading something new/i.test(modalText)) return { dismissed: false };
      const buttons = [...document.querySelectorAll("button")];
      const ok = buttons.find((button) => /^(ok|okay)$/i.test((button.innerText || button.getAttribute("aria-label") || "").trim()));
      if (!ok) return { dismissed: false, reason: "ok_not_found" };
      ok.click();
      return { dismissed: true };
    })()`,
  ).catch(() => ({ dismissed: false }));
}

async function removeComposerAttachments(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const composer = document.querySelector('#prompt-textarea');
      const form = composer?.closest('form') || document;
      const removeButtons = [...form.querySelectorAll('button')]
        .filter((button) => /^remove file/i.test(button.getAttribute('aria-label') || ""));
      for (const button of removeButtons) button.click();
      return { removed: removeButtons.length };
    })()`,
  ).catch(() => ({ removed: 0 }));
}

export function describeUploadFiles(paths) {
  return paths.map((path) => {
    const absolutePath = resolve(path);
    if (!existsSync(absolutePath)) {
      throw uploadError("input.attachment_file_missing", `Upload file does not exist: ${absolutePath}`, { path: absolutePath });
    }
    const stats = statSync(absolutePath);
    if (!stats.isFile()) {
      throw uploadError("input.attachment_not_file", `Upload path is not a file: ${absolutePath}`, { path: absolutePath });
    }
    return {
      path: absolutePath,
      name: basename(absolutePath),
      bytes: stats.size,
      sha256: fileSha256(absolutePath),
    };
  });
}

export function stageUploadFiles(paths, { stageDir, stamp = utcFileStamp() } = {}) {
  if (!stageDir) return describeUploadFiles(paths);
  const originals = describeUploadFiles(paths);
  mkdirSync(stageDir, { recursive: true, mode: 0o700 });
  return originals.map((original, index) => {
    const stagedPath = resolve(stageDir, stampedName(original.name, stamp, index));
    if (textUploadExtension(original.path)) {
      const source = readFileSync(original.path, "utf8");
      writeFileSync(stagedPath, [
        "<!-- chatgpt-pro-codex staged upload metadata",
        `uploaded-at-utc: ${stamp}`,
        `original-name: ${original.name}`,
        `original-path: ${displayOriginalPath(original.path)}`,
        `original-bytes: ${original.bytes}`,
        `original-sha256: ${original.sha256}`,
        "note: this small unique header prevents ChatGPT duplicate-upload rejection; the full original file content follows.",
        "-->",
        "",
        source,
        "",
        "<!-- end chatgpt-pro-codex staged upload metadata",
        `uploaded-at-utc: ${stamp}`,
        "-->",
        "",
      ].join("\n"), { mode: 0o600 });
    } else {
      copyFileSync(original.path, stagedPath);
      chmodSync(stagedPath, 0o600);
    }
    const [staged] = describeUploadFiles([stagedPath]);
    return {
      ...staged,
      original: {
        path: original.path,
        name: original.name,
        bytes: original.bytes,
        sha256: original.sha256,
      },
      staged: true,
      stagedAt: stamp,
    };
  });
}

async function waitForUploadEvidence(cdp, files, { timeoutMs = 60_000 } = {}) {
  const names = files.map((file) => file.name);
  const startedAt = Date.now();
  let lastEvidence = null;
  while (Date.now() - startedAt < timeoutMs) {
    const evidence = await evaluate(
      cdp,
      `(() => {
        const composer = document.querySelector('#prompt-textarea');
        const form = composer?.closest('form') || composer?.closest('[class*="composer"]') || document.body;
        const input = document.querySelector('#upload-files');
        const formRect = form?.getBoundingClientRect?.() || null;
        const chips = [...(form || document.body).querySelectorAll('[data-testid*="attachment"], [data-testid*="file"], [aria-label*="file" i], [aria-label*="upload" i]')]
          .map((el) => ({
            text: (el.innerText || "").slice(0, 200),
            aria: el.getAttribute("aria-label") || "",
            testid: el.getAttribute("data-testid") || "",
            rect: (() => {
              const r = el.getBoundingClientRect();
              return { x: r.x, y: r.y, w: r.width, h: r.height };
            })()
          }))
          .filter((chip) => chip.rect.w > 0 && chip.rect.h > 0 && chip.rect.y >= 0 && chip.rect.y <= window.innerHeight);
        return {
          formText: (form?.innerText || "").slice(0, 1000),
          formRect: formRect ? { x: formRect.x, y: formRect.y, w: formRect.width, h: formRect.height } : null,
          chips,
          inputFiles: input ? [...input.files].map((file) => ({ name: file.name, size: file.size })) : []
        };
      })()`,
    );
    const haystack = [
      evidence.formText || "",
      ...(evidence.chips || []).flatMap((chip) => [chip.text, chip.aria, chip.testid]),
    ].join("\n");
    const matchedInChip = (name) => (evidence.chips || []).some((chip) =>
      [chip.text, chip.aria, chip.testid].join("\n").includes(name),
    );
    const redactedEvidence = {
      chips: evidence.chips || [],
      inputFiles: evidence.inputFiles || [],
      visibleFileNames: names.filter((name) => matchedInChip(name)),
      formTextSha256: textSha256(evidence.formText || ""),
      formTextChars: (evidence.formText || "").length,
      formRect: evidence.formRect || null,
    };
    lastEvidence = redactedEvidence;
    if (names.every((name) => matchedInChip(name))) {
      return {
        ok: true,
        matchedBy: "visible_filename",
        evidence: redactedEvidence,
      };
    }
    const uploading = /uploading|processing|attached|file/i.test(haystack);
    if (uploading) {
      await sleep(1000);
      continue;
    }
    await sleep(500);
  }
  return {
    ok: false,
    matchedBy: "timeout",
    evidence: lastEvidence,
  };
}

export async function uploadFiles(cdp, paths, { timeoutMs = 60_000, stageDir = "" } = {}) {
  const files = stageUploadFiles(paths, { stageDir });
  if (!files.length) return { ok: true, files: [], inputSelector: null, evidence: null };

  await cdp.send("DOM.enable").catch(() => {});
  const dismissedDialog = await dismissUploadDialog(cdp);
  const removedExisting = await removeComposerAttachments(cdp);
  if (dismissedDialog.dismissed || removedExisting.removed) await sleep(750);
  const input = await fileInputNodeId(cdp);
  await cdp.send("DOM.setFileInputFiles", {
    nodeId: input.nodeId,
    files: [],
  }).catch(() => {});
  await cdp.send("DOM.setFileInputFiles", {
    nodeId: input.nodeId,
    files: files.map((file) => file.path),
  });
  await evaluate(
    cdp,
    `(() => {
      const input = document.querySelector('#upload-files');
      if (!input) return false;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
  ).catch(() => {});
  const evidence = await waitForUploadEvidence(cdp, files, { timeoutMs });
  if (!evidence.ok) {
    throw uploadError("input.attachment_upload_failed", "Files were set on the ChatGPT file input, but upload chips were not observed.", {
      files,
      evidence,
    });
  }

  return {
    ok: true,
    inputSelector: input.selector,
    files,
    cleanup: {
      dismissedDialog,
      removedExisting,
    },
    evidence,
  };
}
