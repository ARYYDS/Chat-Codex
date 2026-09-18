import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { sha256 } from "./chatgpt-messages.mjs";

const defaults = {
  "codex-session-digest.md": 12_000,
  "chatgpt-history.md": 200_000,
  "repo-context.md": 1_500_000,
  "manifest.json": 8_000,
  "diff.patch": 20_000,
  "test-output.txt": 20_000,
};

const orderedFiles = [
  { name: "codex-session-digest.md", title: "Codex Session Digest", language: "markdown" },
  { name: "chatgpt-history.md", title: "ChatGPT Conversation History", language: "markdown" },
  { name: "repo-context.md", title: "Repo Context", language: "markdown" },
  { name: "manifest.json", title: "Repo Manifest Summary", language: "json", fallbackOnly: "repo-context.md" },
  { name: "diff.patch", title: "Current Diff", language: "diff" },
  { name: "test-output.txt", title: "Test Output", language: "text" },
];

function sectionForFile({ filePath, contextDir, spec, budget }) {
  const text = readFileSync(filePath, "utf8");
  const stats = statSync(filePath);
  const entry = {
    file: spec.name,
    path: filePath,
    sizeBytes: stats.size,
    charCount: text.length,
    sha256: sha256(text),
    budget,
    included: text.length <= budget,
    truncated: text.length > budget,
  };

  if (!entry.included) {
    return {
      entry,
      markdown: [
        `## ${spec.title}: \`${spec.name}\``,
        "",
        `Omitted: ${spec.name} is ${text.length} chars / ${stats.size} bytes, above budget ${budget}.`,
        `Path: ${filePath}`,
        `sha256: ${entry.sha256}`,
        "",
      ].join("\n"),
    };
  }

  return {
    entry,
    markdown: [
      `## ${spec.title}: \`${spec.name}\``,
      "",
      `Path: ${filePath}`,
      `sha256: ${entry.sha256}`,
      "",
      `\`\`\`${spec.language}`,
      text.replaceAll("```", "``\\`"),
      "```",
      "",
    ].join("\n"),
  };
}

export function composeContextEnvelope({ prompt, contextDir, budgets = {} }) {
  if (!contextDir) {
    return {
      prompt,
      context: null,
    };
  }

  const dir = resolve(contextDir);
  const includedFiles = [];
  const omittedFiles = [];
  const files = [];
  const sections = [];

  for (const spec of orderedFiles) {
    if (spec.fallbackOnly && existsSync(resolve(dir, spec.fallbackOnly))) continue;
    const filePath = resolve(dir, spec.name);
    if (!existsSync(filePath)) continue;
    const budget = Number(budgets[spec.name] || defaults[spec.name]);
    const section = sectionForFile({ filePath, contextDir: dir, spec, budget });
    sections.push(section.markdown);
    files.push(section.entry);
    if (section.entry.included) includedFiles.push(section.entry);
    else omittedFiles.push(section.entry);
  }

  const context = {
    contextDir: dir,
    directoryName: basename(dir),
    includedFiles,
    omittedFiles,
    files,
    sectionOrder: files.map((entry) => entry.file),
    totalIncludedChars: includedFiles.reduce((sum, entry) => sum + entry.charCount, 0),
  };

  if (!sections.length) {
    return {
      prompt: [
        prompt.trim(),
        "",
        "---",
        "",
        "# Context Directory",
        "",
        `Path: ${dir}`,
        "",
        "No recognized context files were found.",
        "",
      ].join("\n"),
      context,
    };
  }

  return {
    prompt: [
      prompt.trim(),
      "",
      "---",
      "",
      "# Context Directory",
      "",
      `Path: ${dir}`,
      "",
      ...sections,
    ].join("\n"),
    context,
  };
}
