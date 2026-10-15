#!/usr/bin/env node
/*
 * Capture the docs' screenshots from the local dev server: `npm run docs:shots`.
 *
 * Each image lives beside the pages that show it (docs/publishing/img/editor.png), and a page
 * references it as a relative Markdown image, so GitHub, the Docs tab (scripts/build-client.mjs
 * copies it into the served tree), and getkestrel.dev (its sync copies it) all show the same
 * file. This script is how those files are made, so a change to the UI is one rerun away
 * from docs that show it.
 *
 * Prerequisite: this directory's dev server, seeded with the demo publication:
 *   npm run dev
 *   npm run seed
 *   npm run docs:shots                 # every shot
 *   npm run docs:shots -- editor       # only the shots whose file name contains "editor"
 *
 * No dependencies: it drives the installed Chrome over the DevTools Protocol (Node 22's
 * global fetch and WebSocket), as getkestrel.dev's landing-page shots do. CHROME_BIN names
 * another Chrome. Light theme only, at a 2x device scale so the images stay sharp at the
 * Docs tab's column width. The target is found as for the seed: this directory's own dev
 * server, proven by its run ID, or one named deliberately by a URL or port argument. It
 * reads the demo through the API to find each view, and writes nothing to the database
 * (the import shot plans an import and never commits it).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { callApi, devTarget, fail } from "../cli/dev-api.mjs";

const TAG = "docs:shots";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const CHROME =
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** The viewport, in CSS pixels, before the 2x scale. */
const VIEW = { width: 1200, height: 760, scale: 2 };

/** The demo's draft (`demo/posts/6-try-editing-this-draft/`), which the editor shot opens on Preview. */
const DEMO_DRAFT_SLUG = "try-editing-this-draft";
/** The demo's sent post whose record has a bounce, a complaint, and unsent recipients. */
const DEMO_RECORD_SUBJECT = "An old-fashioned list";

/** A file for the import shot to plan: every case the plan reports, on the demo's list. */
const IMPORT_CSV = `email,status,opt_in,origin,suppression,subscribed_at,unsubscribed_at
ada@example.com,subscribed,double,sendy,,2024-03-01T09:30:00Z,
grace@example.com,subscribed,single,mailchimp,,2024-05-12T14:00:00Z,
linus@example.com,subscribed,double,sendy,,2024-06-02T08:15:00Z,
margaret@example.com,subscribed,double,sendy,,2024-07-19T17:45:00Z,
edsger@example.com,unsubscribed,unknown,unknown,,,2025-01-20T08:00:00Z
barbara@example.com,unsubscribed,double,sendy,,2024-02-01T10:00:00Z,2025-03-04T12:00:00Z
bounced@example.com,none,unknown,unknown,bounce,,
not-an-address,subscribed,unknown,unknown,,,
`;

/**
 * The shots, each a file under docs/ and how to reach its view. `open` returns the route
 * (the dashboard's hash) from what the API says; `ready` is a selector that exists once the
 * view has loaded; `act` runs in the page before the shot, and `settled` is true once its
 * result shows. `bottom` names the element whose content the shot ends below, so a short view leaves no
 * empty page under it; without it the shot is the whole viewport, `height` tall.
 */
const SHOTS = [
  {
    file: "publishing/img/editor.png",
    open: async (api) => `#/edit/${(await draft(api)).id}`,
    ready: "#previewFrame",
    act: `document.querySelector('.ctab[data-tab="preview"]').click()`,
    settled: `(() => { const f = document.querySelector("#previewFrame"); return !f.hidden && f.style.height !== ""; })()`,
  },
  {
    file: "publishing/img/import-plan.png",
    open: async () => "#/subscribers/import",
    ready: "#impChoose",
    upload: { selector: "#impInput", name: "subscribers.csv", content: IMPORT_CSV },
    settled: `!!document.querySelector(".imp-file")`,
    height: 1400,
    bottom: ".imp",
  },
  {
    file: "publishing/img/send-record.png",
    open: async (api) => {
      const { sends } = await api("/api/sends");
      const send = sends.find((s) => s.subject === DEMO_RECORD_SUBJECT);
      if (!send) {
        fail(
          TAG,
          `the demo's "${DEMO_RECORD_SUBJECT}" send isn't on this server. Run \`npm run seed\`.`,
        );
      }
      return `#/sent/${send.id}`;
    },
    ready: ".rec-tile",
    height: 1400,
    bottom: "main",
  },
];

/** The demo's draft, or exit saying to seed. */
async function draft(api) {
  const { posts } = await api("/api/posts");
  const post = posts.find((p) => p.slug === DEMO_DRAFT_SLUG);
  if (!post) {
    fail(TAG, `the demo's draft "${DEMO_DRAFT_SLUG}" isn't on this server. Run \`npm run seed\`.`);
  }
  return post;
}

/** A minimal DevTools Protocol client over one flattened browser connection. */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) {
          reject(new Error(msg.error.message));
        } else {
          resolve(msg.result);
        }
      } else if (msg.method) {
        for (const l of this.listeners) {
          l(msg);
        }
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  once(pred) {
    return new Promise((resolve) => {
      const l = (msg) => {
        if (pred(msg)) {
          this.listeners.delete(l);
          resolve(msg);
        }
      };
      this.listeners.add(l);
    });
  }
}

/** Start a headless Chrome in a throwaway profile and connect to it. */
async function launchChrome() {
  if (!existsSync(CHROME)) {
    fail(TAG, `no Chrome at ${CHROME}. Set CHROME_BIN to a Chrome or Chromium binary.`);
  }
  const userDataDir = await mkdtemp(join(tmpdir(), "kestrel-docs-shots-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--disable-gpu",
      "--force-color-profile=srgb",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  // Chrome writes the port it chose to DevToolsActivePort once it's listening.
  const portFile = join(userDataDir, "DevToolsActivePort");
  let wsUrl;
  for (let i = 0; i < 200 && !wsUrl; i++) {
    if (existsSync(portFile)) {
      const port = (await readFile(portFile, "utf8")).split("\n")[0].trim();
      wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json())
        .webSocketDebuggerUrl;
    } else {
      await sleep(50);
    }
  }
  if (!wsUrl) {
    chrome.kill();
    fail(TAG, "Chrome did not open a DevTools endpoint in time.");
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("could not connect to Chrome")), {
      once: true,
    });
  });
  return {
    cdp: new CDP(ws),
    cleanup: async () => {
      ws.close();
      chrome.kill();
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/** Evaluate `expression` in the page and return its value. */
async function evaluate(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (exceptionDetails) {
    throw new Error(
      `${expression}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`,
    );
  }
  return result.value;
}

/** Wait until `expression` is truthy in the page, or fail naming what never appeared. */
async function waitFor(cdp, sessionId, expression, what) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(cdp, sessionId, expression).catch(() => false)) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`${what} never appeared`);
}

/** Capture one shot as a PNG. */
async function capture(cdp, base, route, shot, scratch) {
  const height = shot.height ?? VIEW.height;
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  try {
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("DOM.enable", {}, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: VIEW.width, height, deviceScaleFactor: VIEW.scale, mobile: false },
      sessionId,
    );
    await cdp.send(
      "Emulation.setEmulatedMedia",
      { features: [{ name: "prefers-color-scheme", value: "light" }] },
      sessionId,
    );
    const loaded = cdp.once((m) => m.method === "Page.loadEventFired" && m.sessionId === sessionId);
    await cdp.send("Page.navigate", { url: `${base}/dashboard/${route}` }, sessionId);
    await loaded;
    await waitFor(
      cdp,
      sessionId,
      `!!document.querySelector(${JSON.stringify(shot.ready)})`,
      shot.ready,
    );
    if (shot.upload) {
      const file = join(scratch, shot.upload.name);
      await writeFile(file, shot.upload.content);
      const { root } = await cdp.send("DOM.getDocument", {}, sessionId);
      const { nodeId } = await cdp.send(
        "DOM.querySelector",
        { nodeId: root.nodeId, selector: shot.upload.selector },
        sessionId,
      );
      await cdp.send("DOM.setFileInputFiles", { nodeId, files: [file] }, sessionId);
      await evaluate(
        cdp,
        sessionId,
        `document.querySelector(${JSON.stringify(shot.upload.selector)}).dispatchEvent(new Event("change"))`,
      );
    }
    if (shot.act) {
      await evaluate(cdp, sessionId, shot.act);
    }
    if (shot.settled) {
      await waitFor(cdp, sessionId, shot.settled, `${shot.file}'s view`);
    }
    // Webfonts settle, the caret leaves the page, and paint gets a beat. The sidebar's
    // "Local dev" badge is hidden: a deployed dashboard never shows it.
    await evaluate(cdp, sessionId, "document.fonts ? document.fonts.ready.then(() => true) : true");
    await evaluate(
      cdp,
      sessionId,
      `document.activeElement?.blur(); document.head.appendChild(Object.assign(document.createElement("style"), { textContent: ".who.dev { visibility: hidden !important; }" })); true`,
    );
    await sleep(500);
    const end = shot.bottom
      ? await evaluate(
          cdp,
          sessionId,
          `Math.ceil(Math.max(...[...document.querySelectorAll(${JSON.stringify(`${shot.bottom} *`)})].map((e) => e.getBoundingClientRect().bottom)))`,
        )
      : height;
    const clip = { x: 0, y: 0, width: VIEW.width, height: Math.min(height, end + 40), scale: 1 };
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip }, sessionId);
    return Buffer.from(data, "base64");
  } finally {
    await cdp.send("Target.closeTarget", { targetId });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => /^https?:\/\//.test(a) || /^\d+$/.test(a));
  const only = args.filter((a) => a !== target);
  const shots = only.length ? SHOTS.filter((s) => only.some((o) => s.file.includes(o))) : SHOTS;
  if (!shots.length) {
    fail(
      TAG,
      `no shot matches ${only.join(", ")}. The shots: ${SHOTS.map((s) => s.file).join(", ")}.`,
    );
  }
  const { base, token } = await devTarget(target, TAG);
  const api = async (path) => {
    const res = await callApi(base, token, path, { tag: TAG });
    if (!res.ok) {
      fail(TAG, `${path} answered ${res.status}.`);
    }
    return res.body;
  };

  const scratch = await mkdtemp(join(tmpdir(), "kestrel-docs-shots-files-"));
  const { cdp, cleanup } = await launchChrome();
  try {
    for (const shot of shots) {
      const png = await capture(cdp, base, await shot.open(api), shot, scratch);
      const file = join(DOCS, shot.file);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, png);
      console.log(`[${TAG}] ${relative(ROOT, file)}  ${(png.length / 1024).toFixed(0)} KB`);
    }
  } finally {
    await cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`[${TAG}] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
