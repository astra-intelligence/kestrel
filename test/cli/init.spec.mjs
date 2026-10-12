/*
 * `kestrel init`'s production flags (cli/init.mjs): the hostnames and From address it writes
 * into the new instance's `production` block, what it refuses, and that a run without them
 * writes the template as it ships. Plain Node: cli/ is plain Node, and so is its suite.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { experimental_readRawConfig } from "wrangler";
import { fillProduction, initCommand, readInitArgs } from "../../cli/init.mjs";

const TEMPLATE_PATH = join(import.meta.dirname, "../../template/wrangler.jsonc");
const TEMPLATE = readFileSync(TEMPLATE_PATH, "utf8");

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kestrel-init-"));
  vi.spyOn(console, "error");
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** A wrangler.jsonc, parsed as wrangler reads it. */
const parse = (path) => experimental_readRawConfig({ config: path }).rawConfig;
const config = (root) => parse(join(root, "wrangler.jsonc"));

describe("kestrel init", () => {
  it("writes the template's wrangler.jsonc unchanged when given no flags", () => {
    initCommand([dir]);
    expect(readFileSync(join(dir, "wrangler.jsonc"), "utf8")).toBe(TEMPLATE);
  });

  it("writes the app and sending hostnames into every production setting that repeats them", () => {
    initCommand([dir, "--app-host", "News.Acme.org", "--sending-host=send.acme.org"]);
    const production = config(dir).env.production;
    expect(production.routes).toEqual([{ pattern: "news.acme.org", custom_domain: true }]);
    expect(production.vars.APP_ORIGIN).toBe("https://news.acme.org");
    expect(production.vars.SENDING_DOMAIN).toBe("send.acme.org");
    expect(production.vars.FROM_ADDRESS).toBe("Newsletter <newsletter@send.acme.org>");
    // The D1 id exists only after `wrangler d1 create`, and development stays as it ships.
    expect(production.d1_databases[0].database_id).toBe("REPLACE_WITH_PRODUCTION_D1_ID");
    expect(config(dir).vars).toEqual(parse(TEMPLATE_PATH).vars);
  });

  it("keeps the template's comments and changes no other line", () => {
    initCommand([dir, "--app-host", "news.acme.org", "--sending-host", "send.acme.org"]);
    const before = TEMPLATE.split("\n");
    const after = readFileSync(join(dir, "wrangler.jsonc"), "utf8").split("\n");
    expect(after.length).toBe(before.length);
    const changed = after.filter((line, i) => line !== before[i]).map((line) => line.trim());
    expect(changed).toEqual([
      '"routes": [{ "pattern": "news.acme.org", "custom_domain": true }],',
      '"APP_ORIGIN": "https://news.acme.org",',
      '"SENDING_DOMAIN": "send.acme.org",',
      '"FROM_ADDRESS": "Newsletter <newsletter@send.acme.org>",',
    ]);
  });

  it("uses a --from on the sending hostname as given, quotes and all", () => {
    initCommand([
      dir,
      "--sending-host",
      "send.acme.org",
      "--from",
      'The "Acme" Letter <hello@Send.Acme.org>',
    ]);
    const vars = config(dir).env.production.vars;
    expect(vars.FROM_ADDRESS).toBe('The "Acme" Letter <hello@Send.Acme.org>');
    // The app hostname wasn't given, so it keeps the template's placeholder.
    expect(vars.APP_ORIGIN).toBe("https://newsletter.example.com");
  });

  it("refuses a bad value before writing anything, naming the flag", () => {
    expect(() => initCommand([dir, "--app-host", "https://news.acme.org/"])).toThrow("exit 1");
    expect(readdirSync(dir)).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("--app-host takes a bare hostname"),
    );
  });
});

describe("readInitArgs", () => {
  const refusal = (argv) => readInitArgs(argv).refuse;

  it("reads the directory and the flags in any order", () => {
    expect(readInitArgs([])).toEqual({ dir: "." });
    expect(readInitArgs(["--app-host", "news.acme.org", "inst"])).toEqual({
      dir: "inst",
      appHost: "news.acme.org",
    });
  });

  it("refuses a hostname with a scheme, port, path, or no dot, naming the flag", () => {
    for (const bad of [
      "https://news.acme.org",
      "news.acme.org:443",
      "news.acme.org/x",
      "localhost",
      "",
      "-x.acme.org",
      "a..org",
    ]) {
      expect(refusal(["--app-host", bad])).toMatch(/^--app-host takes a bare hostname/);
      expect(refusal(["--sending-host", bad])).toMatch(/^--sending-host takes a bare hostname/);
    }
  });

  it("refuses the guide's example.com placeholders", () => {
    expect(refusal(["--app-host", "newsletter.example.com"])).toMatch(
      /^--app-host is the setup guide's example.com placeholder/,
    );
    expect(refusal(["--sending-host", "example.com"])).toMatch(
      /^--sending-host is the setup guide's example.com placeholder/,
    );
  });

  it("refuses a --from off the sending hostname, not an address, or without --sending-host", () => {
    expect(refusal(["--from", "a@send.acme.org"])).toBe(
      "--from needs --sending-host, the hostname its address is on.",
    );
    expect(refusal(["--sending-host", "send.acme.org", "--from", "a@acme.org"])).toBe(
      "--from must be an address on the sending hostname, send.acme.org, not acme.org.",
    );
    for (const bad of ["Acme", "Acme <>", "@send.acme.org", "a b@send.acme.org"]) {
      expect(refusal(["--sending-host", "send.acme.org", "--from", bad])).toMatch(
        /^--from takes an email address/,
      );
    }
    expect(
      readInitArgs(["--sending-host", "send.acme.org", "--from", "a@send.acme.org"]).from,
    ).toBe("a@send.acme.org");
  });

  it("refuses an unknown option or a second directory, rather than ignoring it", () => {
    expect(refusal(["--app-hostname", "news.acme.org"])).toMatch(
      /^unknown option --app-hostname\./,
    );
    expect(refusal(["-y"])).toMatch(/^unknown option -y\./);
    expect(refusal(["one", "two"])).toBe("init takes one directory, not one two.");
  });
});

describe("fillProduction", () => {
  it("fails loud when the template no longer holds a value it fills", () => {
    const drifted = TEMPLATE.replace(
      '"SENDING_DOMAIN": "send.example.com",\n        "FROM',
      '"FROM',
    );
    expect(() =>
      fillProduction(drifted, { sendingHost: "send.acme.org", from: "a@send.acme.org" }),
    ).toThrow(/has 0 of "SENDING_DOMAIN": "send.example.com", not one/);
  });
});
