/*
 * `kestrel init [dir]`: write a new instance repository from the scaffold this release ships.
 *
 * Run as `npx @kurtbruns/kestrel init` in an empty repository. The scaffold lives in
 * `template/` and ships in the package, so a new instance always matches the release that
 * creates it. It writes the instance's package.json (pinning this exact release), its
 * wrangler config and one-line Worker entry, `.dev.vars.example`, the Claude context with its
 * headers (cli/context.mjs), and this release's migrations.
 *
 * A few files ship under other names and are renamed here: npm leaves `.gitignore` and
 * `.npmrc` out of a published package, and the Claude files sit outside `.claude/` so they
 * don't load into sessions in Kestrel's own repository. Init never overwrites: if any file it
 * would write exists already, it writes nothing and names them.
 *
 * `--app-host`, `--sending-host`, and `--from` fill the `production` block of wrangler.jsonc,
 * which otherwise repeats each hostname by hand: the app hostname in the route and
 * `APP_ORIGIN`, the sending hostname in `SENDING_DOMAIN` and `FROM_ADDRESS`. They are flags
 * only, never a prompt, so a run with no terminal (CI, Claude) can't hang waiting for an
 * answer, and a run without them writes the template as it ships, for the setup guide's
 * by-hand edit. The values are checked before anything is written. The D1 id stays a
 * placeholder, since the database exists only after `wrangler d1 create`.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTEXT_FILES, writeShipped } from "./context.mjs";
import { parseArgs } from "./dev-api.mjs";
import { syncMigrationsCommand } from "./sync-migrations.mjs";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(PACKAGE_ROOT, "template");
const PACKAGE = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));

// Shipped name → name in the instance.
const RENAMED = { gitignore: ".gitignore", npmrc: ".npmrc", claude: ".claude" };

/** Every scaffold file as [path in the package, path in the instance], context files aside. */
function scaffoldFiles(dir = TEMPLATE, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const from = join(dir, entry.name);
    if (entry.isDirectory()) {
      scaffoldFiles(from, out);
      continue;
    }
    // Split on either separator, so the names match on Windows too.
    const to = relative(TEMPLATE, from)
      .split(/[\\/]/)
      .map((part) => RENAMED[part] ?? part)
      .join("/");
    if (!CONTEXT_FILES.includes(to)) {
      out.push([from, to]);
    }
  }
  return out;
}

/** An npm package name made from the directory's name, or `newsletter`. */
function packageName(dir) {
  const name = basename(dir)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[-]+$/g, "");
  return name || "newsletter";
}

const OPTIONS = ["app-host", "sending-host", "from"];

// What the template's production block holds until init or the operator fills it.
const PLACEHOLDER = { appHost: "newsletter.example.com", sendingHost: "send.example.com" };

/** The From address init writes when `--sending-host` comes without `--from`. */
const defaultFrom = (host) => `Newsletter <newsletter@${host}>`;

// One DNS label: letters, digits, and inner hyphens, at most 63 characters.
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** `value` as a bare lowercase hostname, or a refusal naming `flag`. */
function readHost(flag, value) {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  const labels = host.split(".");
  if (labels.length < 2 || host.length > 253 || !labels.every((l) => LABEL.test(l))) {
    return {
      refuse: `--${flag} takes a bare hostname such as ${PLACEHOLDER[flag === "app-host" ? "appHost" : "sendingHost"]}, with no https://, port, or path, not "${value}".`,
    };
  }
  // The guide's example names; the app refuses them too, but only once a provider is set.
  if (host === "example.com" || host.endsWith(".example.com")) {
    return {
      refuse: `--${flag} is the setup guide's example.com placeholder; give your own hostname.`,
    };
  }
  return { host };
}

/**
 * What `kestrel init` was asked for: `{ dir, appHost?, sendingHost?, from? }`, with the
 * hostnames lowercased and From defaulted from the sending host, or `{ refuse }` with a
 * message naming the flag at fault.
 */
export function readInitArgs(argv) {
  const { flags, positional } = parseArgs(argv);
  const unknown = [
    ...Object.keys(flags)
      .filter((f) => !OPTIONS.includes(f))
      .map((f) => `--${f}`),
    ...positional.filter((p) => p.startsWith("-")),
  ];
  if (unknown.length > 0) {
    return {
      refuse: `unknown option ${unknown[0]}. init takes [dir], --app-host, --sending-host, and --from.`,
    };
  }
  if (positional.length > 1) {
    return { refuse: `init takes one directory, not ${positional.join(" ")}.` };
  }
  const args = { dir: positional[0] ?? "." };
  for (const flag of ["app-host", "sending-host"]) {
    if (flags[flag] === undefined) {
      continue;
    }
    const read = readHost(flag, flags[flag]);
    if (read.refuse) {
      return read;
    }
    args[flag === "app-host" ? "appHost" : "sendingHost"] = read.host;
  }
  if (flags.from !== undefined) {
    if (!args.sendingHost) {
      return { refuse: "--from needs --sending-host, the hostname its address is on." };
    }
    const from = flags.from.trim();
    // As the app reads it (src/env.ts): the address is the last `<…>`, else the whole value.
    const address = /<([^<>]*)>$/.exec(from)?.[1].trim() ?? from;
    const at = address.lastIndexOf("@");
    if (at < 1 || at === address.length - 1 || /\s/.test(address)) {
      return {
        refuse: `--from takes an email address, optionally with a name, such as "${defaultFrom(args.sendingHost)}", not "${flags.from}".`,
      };
    }
    const domain = address.slice(at + 1).toLowerCase();
    if (domain !== args.sendingHost) {
      return {
        refuse: `--from must be an address on the sending hostname, ${args.sendingHost}, not ${domain}.`,
      };
    }
    args.from = from;
  } else if (args.sendingHost) {
    args.from = defaultFrom(args.sendingHost);
  }
  return args;
}

/**
 * The template's wrangler.jsonc text with the given values written into its `production`
 * block, comments and layout kept. Each value it replaces must appear there exactly once,
 * so a template that drifts fails loud here rather than writing half a configuration.
 */
export function fillProduction(text, { appHost, sendingHost, from }) {
  const start = text.indexOf('"production": {');
  if (start < 0) {
    throw new Error("template/wrangler.jsonc has no production block");
  }
  let block = text.slice(start);
  const set = (key, before, after) => {
    const was = `${JSON.stringify(key)}: ${JSON.stringify(before)}`;
    const parts = block.split(was);
    if (parts.length !== 2) {
      throw new Error(
        `template/wrangler.jsonc's production block has ${parts.length - 1} of ${was}, not one`,
      );
    }
    block = parts.join(`${JSON.stringify(key)}: ${JSON.stringify(after)}`);
  };
  if (appHost) {
    set("pattern", PLACEHOLDER.appHost, appHost);
    set("APP_ORIGIN", `https://${PLACEHOLDER.appHost}`, `https://${appHost}`);
  }
  if (sendingHost) {
    set("SENDING_DOMAIN", PLACEHOLDER.sendingHost, sendingHost);
    set("FROM_ADDRESS", defaultFrom(PLACEHOLDER.sendingHost), from);
  }
  return text.slice(0, start) + block;
}

/** `kestrel init [dir] [--app-host <host>] [--sending-host <host> [--from <address>]]`. */
export function initCommand(argv) {
  const args = readInitArgs(argv);
  if (args.refuse) {
    console.error(`[init] refused: ${args.refuse}`);
    process.exit(1);
  }
  const root = resolve(args.dir);
  const files = [
    ...scaffoldFiles(),
    [join(PACKAGE_ROOT, ".dev.vars.example"), ".dev.vars.example"],
  ];
  // A migration of this release's already there counts too, since sync-migrations refuses
  // to overwrite one, and by then everything else would have been written.
  const migrations = readdirSync(join(PACKAGE_ROOT, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => `migrations/${f}`);
  const writes = [...files.map(([, to]) => to), ...CONTEXT_FILES, ...migrations];
  const taken = writes.filter((to) => existsSync(join(root, to)));
  if (taken.length > 0) {
    console.error(
      `[init] refused: ${taken.join(", ")} already exist${taken.length === 1 ? "s" : ""} in ${root}.\n` +
        "Run init in an empty repository (created without a README, .gitignore, or license).",
    );
    process.exit(1);
  }

  for (const [from, to] of files) {
    mkdirSync(dirname(join(root, to)), { recursive: true });
    copyFileSync(from, join(root, to));
  }
  // The instance pins this exact release, and the tools at the versions it was tested with.
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  pkg.name = packageName(root);
  pkg.dependencies[PACKAGE.name] = PACKAGE.version;
  pkg.devDependencies.typescript = PACKAGE.devDependencies.typescript;
  pkg.devDependencies.wrangler = PACKAGE.peerDependencies.wrangler;
  writeFileSync(join(root, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  if (args.appHost || args.sendingHost) {
    const config = join(root, "wrangler.jsonc");
    writeFileSync(config, fillProduction(readFileSync(config, "utf8"), args));
  }
  for (const file of CONTEXT_FILES) {
    writeShipped(root, file);
  }
  syncMigrationsCommand(root);

  // A path from here when the instance is below this directory, else the absolute one.
  const rel = relative(process.cwd(), root);
  const where = rel.startsWith("..") ? root : rel;
  const filled = [
    ...(args.appHost ? [`answers on https://${args.appHost}`] : []),
    ...(args.sendingHost ? [`sends from ${args.from}`] : []),
  ];
  console.log(
    `[init] a Kestrel ${PACKAGE.version} instance${where ? ` in ${where}` : ""}` +
      `${filled.length ? `, whose production ${filled.join(" and ")}` : ""}. Next:`,
  );
  console.log(
    [
      ...(where ? [`  cd ${where}`] : []),
      "  npm install",
      "  cp .dev.vars.example .dev.vars",
      "  npm run dev",
      "Then commit, and follow the setup guide (node_modules/@kurtbruns/kestrel/docs/README.md) to deploy.",
    ].join("\n"),
  );
}
