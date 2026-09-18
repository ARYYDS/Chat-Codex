export const now = () => performance.now();
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  if (!response.ok) throw new Error(`CDP /json -> ${response.status}`);
  return response.json();
}

export async function connectToPage(port, { matchUrl, retries = 30, delayMs = 100 } = {}) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const targets = await listTargets(port);
      const pages = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
      const target =
        (matchUrl && pages.find((page) => (page.url || "").startsWith(matchUrl))) || pages[0];
      if (target) return await CdpSession.open(target.webSocketDebuggerUrl);
    } catch {
      // Chrome may still be starting; retry below.
    }
    await sleep(delayMs);
  }
  throw new Error("No inspectable page target on CDP endpoint.");
}

export async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    throw new Error(
      exceptionDetails.exception?.description || exceptionDetails.text || "evaluate failed",
    );
  }
  return result.value;
}

export async function clickAt(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

export class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (event) => this.#onMessage(event));
  }

  static open(wsUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.addEventListener("open", () => resolve(new CdpSession(ws)));
      ws.addEventListener("error", (event) =>
        reject(new Error(`CDP socket error: ${event?.message || "unknown"}`)),
      );
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(handler);
    return () => this.listeners.get(method)?.delete(handler);
  }

  async close() {
    try {
      this.ws.close();
    } catch {
      // Already closed.
    }
  }

  #onMessage(event) {
    let message;
    try {
      message = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
    } catch {
      return;
    }

    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} (code ${message.error.code})`));
      else resolve(message.result);
      return;
    }

    if (!message.method) return;
    const handlers = this.listeners.get(message.method);
    if (handlers) for (const handler of [...handlers]) handler(message.params);
  }
}
