import { clickAt, evaluate, sleep } from "./cdp-client.mjs";

const MENU_OPEN_DELAY_MS = 350;

function normalize(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeModel(value) {
  return normalize(value).replace(/^gpt[-\s]*/, "");
}

function matchChoice(items, requested) {
  const needle = normalize(requested);
  return items.find((item) => normalize(item.label) === needle)
    || items.find((item) => normalize(item.text) === needle)
    || items.find((item) => normalize(item.label).startsWith(needle));
}

function choiceError(message, details = {}) {
  const error = new Error(message);
  error.errorCode = "model.option_unavailable";
  error.details = details;
  return error;
}

export async function readAccountState(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const planPattern = /\\b(Pro|Plus|Team|Enterprise|Free)\\b/i;
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const candidates = [...document.querySelectorAll('[role="button"], button')]
        .filter(visible)
        .map((el) => ({
          text: (el.innerText || "").trim(),
          aria: el.getAttribute("aria-label") || "",
        }));
      const profileSources = candidates
        .filter((item) => /open profile menu/i.test(item.aria) || /open profile menu/i.test(item.text))
        .flatMap((item) => [item.text, item.aria])
        .filter(Boolean);
      const pipePlan = profileSources
        .map((source) => source.match(/\\|\\s*(Pro|Plus|Team|Enterprise|Free)\\b/i)?.[1] || null)
        .find(Boolean);
      const ariaPlan = profileSources
        .map((source) => source.match(/\\b(Pro|Plus|Team|Enterprise|Free)\\b(?=,?\\s*open profile menu)/i)?.[1] || null)
        .find(Boolean);
      const fallbackPlan = profileSources
        .map((source) => source.match(planPattern)?.[1] || null)
        .find(Boolean);
      const knownPlan = pipePlan || ariaPlan || fallbackPlan || null;
      return {
        planLabel: knownPlan,
        isPro: knownPlan ? /^pro$/i.test(knownPlan) : null,
        detected: !!knownPlan,
      };
    })()`,
  );
}

export async function findIntelligenceButton(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const composer =
        [...document.querySelectorAll('textarea[aria-label="Chat with ChatGPT"], textarea[placeholder], [contenteditable="true"][role="textbox"], [role="textbox"][aria-label="Chat with ChatGPT"]')]
          .find(visible) || null;
      const form = composer?.closest("form") || null;
      const button = form
        ? [...form.querySelectorAll('button[aria-haspopup="menu"]')]
            .find((candidate) => (candidate.innerText || "").trim())
        : null;
      if (!button) return null;
      const r = button.getBoundingClientRect();
      return {
        label: (button.innerText || "").trim(),
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    })()`,
  );
}

async function readVisibleChoiceMenus(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      return [...document.querySelectorAll('[role="menu"], [role="listbox"]')]
        .filter(visible)
        .map((menu, menuIndex) => {
          const r = menu.getBoundingClientRect();
          return {
            menuIndex,
            text: (menu.innerText || "").trim().replace(/\\n+/g, " | "),
            x: Math.round(r.left),
            y: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
            items: [...menu.querySelectorAll('[role="menuitemradio"], [role="menuitem"], [role="option"]')]
              .filter(visible)
              .map((el, index) => {
                const rect = el.getBoundingClientRect();
                const lines = (el.innerText || "").trim().split(/\\n+/).map((line) => line.trim()).filter(Boolean);
                return {
                  index,
                  role: el.getAttribute("role"),
                  label: lines[0] || "",
                  detail: lines.slice(1).join(" | "),
                  text: lines.join(" | "),
                  current: el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-selected") === "true",
                  disabled: el.getAttribute("aria-disabled") === "true" || el.hasAttribute("disabled"),
                  hasSubmenu: el.getAttribute("aria-haspopup") === "menu",
                  expanded: el.getAttribute("aria-expanded") === "true",
                  x: Math.round(rect.left + rect.width / 2),
                  y: Math.round(rect.top + rect.height / 2),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                };
              })
              .filter((item) => item.label)
          };
        });
    })()`,
  );
}

async function openIntelligenceMenu(cdp) {
  await closeMenus(cdp);
  await sleep(100);
  const startedAt = performance.now();
  let button = null;
  while (performance.now() - startedAt < 10_000) {
    button = await findIntelligenceButton(cdp);
    if (button) break;
    await sleep(250);
  }
  if (!button) throw new Error("ChatGPT intelligence selector was not found.");
  await clickAt(cdp, button.x, button.y);
  await sleep(MENU_OPEN_DELAY_MS);
  return button;
}

async function closeMenus(cdp) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    }).catch(() => {});
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    }).catch(() => {});
    await sleep(50);
  }
}

async function revealModelSubmenu(cdp, modelRoot) {
  let menus = await readVisibleChoiceMenus(cdp);
  const positions = [
    { x: modelRoot.x, y: modelRoot.y },
    { x: Math.round(modelRoot.x + modelRoot.width / 2 - 6), y: modelRoot.y },
    { x: Math.round(modelRoot.x + modelRoot.width / 2 + 10), y: modelRoot.y },
  ];

  for (const position of positions) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: position.x,
      y: position.y,
    });
    await sleep(MENU_OPEN_DELAY_MS);
    menus = await readVisibleChoiceMenus(cdp);
    if (menus[1]?.items.some((item) => item.role === "menuitemradio")) return menus;
  }

  return menus;
}

function shapeChoices({ account, button, menus }) {
  const intelligenceMenu = menus[0] || null;
  const modelMenu = menus[1] || null;
  const intelligenceItems = intelligenceMenu?.items.filter((item) => item.role === "menuitemradio") || [];
  const modelRoot = intelligenceMenu?.items.find((item) => item.hasSubmenu) || null;
  const modelItems = modelMenu?.items.filter((item) => item.role === "menuitemradio") || [];

  return {
    account,
    intelligence: {
      current: intelligenceItems.find((item) => item.current)?.label || button?.label || null,
      buttonLabel: button?.label || null,
      options: intelligenceItems.map(({ label, text, detail, current, disabled }) => ({
        label,
        text,
        detail,
        current,
        disabled,
      })),
    },
    model: {
      current: modelItems.find((item) => item.current)?.label || null,
      rootLabel: modelRoot?.label || null,
      options: modelItems.map(({ label, text, detail, current, disabled }) => ({
        label,
        text,
        detail,
        current,
        disabled,
      })),
    },
  };
}

export async function readChatGptChoices(cdp, { includeModelOptions = true } = {}) {
  const account = await readAccountState(cdp);
  let button = null;
  let menus = [];
  try {
    button = await openIntelligenceMenu(cdp);
    menus = await readVisibleChoiceMenus(cdp);
    const modelRoot = menus[0]?.items.find((item) => item.hasSubmenu);
    if (includeModelOptions && modelRoot) {
      menus = await revealModelSubmenu(cdp, modelRoot);
    }
  } finally {
    await closeMenus(cdp);
  }

  return shapeChoices({ account, button, menus });
}

async function readChoicesUntilReady(cdp, { needsLevel = false, needsModel = false } = {}) {
  const startedAt = performance.now();
  let choices = await readChatGptChoices(cdp);

  while (performance.now() - startedAt < 20_000) {
    const hasLevelChoices = !needsLevel || choices.intelligence.options.length > 0;
    const hasModelChoices =
      !needsModel
      || choices.model.options.length > 0
      || !!choices.model.current
      || !!choices.model.rootLabel;
    if (hasLevelChoices && hasModelChoices) return choices;
    await sleep(750);
    choices = await readChatGptChoices(cdp);
  }

  return choices;
}

export async function setChatGptChoices(cdp, { level, model } = {}) {
  const before = await readChoicesUntilReady(cdp, {
    needsLevel: !!level,
    needsModel: !!model,
  });
  const selected = {};
  const skipped = {};

  if (level && normalize(level) === normalize(before.intelligence.current)) {
    selected.level = before.intelligence.current;
    skipped.level = "already-current";
  } else if (level) {
    let choice = null;
    let choices = [];
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        await openIntelligenceMenu(cdp);
        const menus = await readVisibleChoiceMenus(cdp);
        choices = menus[0]?.items.filter((item) => item.role === "menuitemradio") || [];
        choice = matchChoice(choices, level);
        if (choice) break;
        await closeMenus(cdp);
        await sleep(500);
      }
      if (!choice) {
        const available = choices.map((item) => item.label).join(", ") || "none";
        throw choiceError(`ChatGPT intelligence level not found: ${level}. Available: ${available}`, {
          requested: level,
          available: choices.map((item) => item.label),
        });
      }
      if (choice.disabled) throw choiceError(`ChatGPT intelligence level is disabled: ${choice.label}`, {
        requested: level,
        disabled: choice.label,
      });
      await clickAt(cdp, choice.x, choice.y);
      selected.level = choice.label;
      await sleep(MENU_OPEN_DELAY_MS);
    } finally {
      await closeMenus(cdp);
    }
  }

  if (
    model
    && (
      normalizeModel(model) === normalizeModel(before.model.current)
      || normalizeModel(model) === normalizeModel(before.model.rootLabel)
    )
  ) {
    selected.model = before.model.current || before.model.rootLabel;
    skipped.model = "already-current";
  } else if (model) {
    let choice = null;
    let choices = [];
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        await openIntelligenceMenu(cdp);
        let menus = await readVisibleChoiceMenus(cdp);
        const modelRoot = menus[0]?.items.find((item) => item.hasSubmenu);
        if (modelRoot) {
          menus = await revealModelSubmenu(cdp, modelRoot);
          choices = menus[1]?.items.filter((item) => item.role === "menuitemradio") || [];
          choice = matchChoice(choices, model);
          if (choice) break;
        }
        await closeMenus(cdp);
        await sleep(500);
      }
      if (!choice) {
        const available = choices.map((item) => item.label).join(", ") || "none";
        throw choiceError(`ChatGPT model choice not found: ${model}. Available: ${available}`, {
          requested: model,
          available: choices.map((item) => item.label),
        });
      }
      if (choice.disabled) throw choiceError(`ChatGPT model choice is disabled: ${choice.label}`, {
        requested: model,
        disabled: choice.label,
      });
      await clickAt(cdp, choice.x, choice.y);
      selected.model = choice.label;
      await sleep(MENU_OPEN_DELAY_MS);
    } finally {
      await closeMenus(cdp);
    }
  }

  const after = await readChatGptChoices(cdp);
  return {
    before,
    selected,
    skipped,
    after,
  };
}
