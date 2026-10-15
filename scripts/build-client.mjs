#!/usr/bin/env node
/*
 * Build the admin SPA's served tree: public/ + client/ (source) → dist/public (served).
 *
 * public/ is pure source and dist/public is pure output, gitignored and rebuilt at will:
 * nothing tracked ever carries a build artifact's hash. The build copies public/ through
 * (styles.css, _headers, favicon — served exactly as written; esbuild never touches the
 * stylesheet), bundles client/main.ts with esbuild to app.js, and generates index.html
 * from its source with each asset's content hash as its `?v=`. public/_headers caches
 * those two paths immutably, and a changed asset is always a new URL. The browser still
 * receives one framework-free, dependency-free, plain-JS asset.
 *
 * Stable names with a `?v=`, not esbuild's content-hashed filenames, on purpose: observed
 * under wrangler 4.129, `wrangler dev` never serves a file added to the assets directory
 * after startup (a rewritten file is served fresh; a new one 404s until restart), so a new
 * filename per rebuild would kill the dev loop. Wrangler has an assets watcher meant to
 * cover exactly that, so this is its bug rather than its design; stable names are the
 * right production cache shape regardless, so nothing here waits on a fix.
 *
 * Builds. Production (the default, and what wrangler's build.command produces for a
 * deploy) is minified with `__DEV__` false, so dev-only code such as the live reload is
 * compiled out. Dev (`--dev`, or KESTREL_CLIENT_DEV=1 for wrangler's build.command, which
 * takes no flag; scripts/dev.mjs sets it) is readable with `__DEV__` true. Both link a
 * sourcemap: readable stack traces from a deployed editor are worth the file, which sits
 * behind Access with the rest of /dashboard.
 *
 * Modes:
 *   (default)  build once; exit non-zero on error.
 *   --watch    keep rebuilding: client/ edits through esbuild's incremental context (~10ms),
 *              public/ edits by re-emitting the copied and generated files. Errors are loud
 *              and the previous output stays in place.
 *   --check    prove the tree builds without writing it (the bundle in memory, the source
 *              index.html's asset references verified). For pretest: a second terminal
 *              running the gate beside a live `npm run dev` must not overwrite the dev
 *              tree with the production build, which would reload the open editor onto a
 *              bundle with no live reload in it.
 *
 * The docs' images (any image file under docs/, beside the pages that show it) are copied to
 * dist/public/dashboard/docs/ at the same path, where the Docs tab's fragments point them
 * (src/docs/index.ts, DOC_MEDIA). Static files behind Access with the rest of /dashboard, so
 * the Worker never serves them. Every image a page references must exist, or the build
 * fails (in --check too, so the gate catches a broken one). Like any file new to the
 * assets directory, an image added while `wrangler dev` runs is served after a restart.
 *
 * Only an explicit build (or a deploy) writes the production build over a live tree.
 * `wrangler types` runs build.command too, for no reason this script serves (type
 * generation never reads the tree), so it is a no-op here: wrangler names its command in
 * WRANGLER_COMMAND for every custom build.
 */
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "public");
const OUT = join(ROOT, "dist", "public");
const ADMIN = "dashboard";
const DOCS = join(ROOT, "docs");
/** Where the docs' images are served from, mirroring docs/ (src/docs/index.ts, DOC_MEDIA). */
const DOCS_OUT = join(OUT, ADMIN, "docs");
const IMAGE = /\.(?:png|jpe?g|gif|webp|svg)$/i;

if (process.env.WRANGLER_COMMAND === "types") {
  process.exit(0);
}

const args = process.argv.slice(2);
const dev = args.includes("--dev") || process.env.KESTREL_CLIENT_DEV === "1";
const watchMode = args.includes("--watch");
const checkMode = args.includes("--check");

/** Content fingerprint of a served asset: first 8 hex of its SHA-256. */
const fingerprint = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 8);

/** The assets index.html references with a `?v=`, by the exact reference form it uses. */
const STAMPED = ["app.js", "styles.css"];

/** The source index.html, checked: a template that lost an asset reference would serve a stale asset in production. */
function sourceIndex() {
  const html = readFileSync(join(SRC, ADMIN, "index.html"), "utf8");
  for (const name of STAMPED) {
    if (!html.includes(`./${name}`)) {
      throw new Error(`index.html no longer references ./${name}; the served copy would be wrong`);
    }
  }
  return html;
}

/** Every file under docs/, as paths relative to it. */
function docsFiles(dir = DOCS) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? docsFiles(join(dir, e.name)) : [relative(DOCS, join(dir, e.name))],
  );
}

/**
 * The docs' images, checked: every relative image a page references (`![alt](img/x.png)`)
 * resolves to a file under docs/, so a page never shows a broken image in the Docs tab, on
 * GitHub, or on getkestrel.dev. Images are written as relative paths; an absolute URL is
 * left to its host.
 */
function docsImages() {
  const files = docsFiles();
  for (const page of files.filter((f) => f.endsWith(".md"))) {
    // Code shows image syntax as written (SPEC's examples), so it's left out.
    const md = readFileSync(join(DOCS, page), "utf8").replace(
      /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$|`[^`\n]+`/gm,
      "",
    );
    for (const [, src] of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) {
      if (!/^[a-z]+:/i.test(src) && !existsSync(join(DOCS, dirname(page), src))) {
        throw new Error(`docs/${page} shows ${src}, which is not a file under docs/`);
      }
    }
  }
  return files.filter((f) => IMAGE.test(f));
}

/**
 * Copy public/ through and generate index.html with each stamped asset's `?v=`. Runs after
 * esbuild has written app.js. The exact reference form (`./app.js`) is rewritten, so a
 * prose mention of app.js in a comment is left alone.
 */
function emitServedTree() {
  mkdirSync(join(OUT, ADMIN), { recursive: true });
  cpSync(SRC, OUT, { recursive: true, filter: (src) => src !== join(SRC, ADMIN, "index.html") });
  let html = sourceIndex();
  for (const name of STAMPED) {
    const ref = `./${name}`;
    html = html.replaceAll(ref, `${ref}?v=${fingerprint(readFileSync(join(OUT, ADMIN, name)))}`);
  }
  writeFileSync(join(OUT, ADMIN, "index.html"), html);
  // Cleared first, so an image removed from docs/ isn't left in the served tree.
  rmSync(DOCS_OUT, { recursive: true, force: true });
  for (const image of docsImages()) {
    mkdirSync(dirname(join(DOCS_OUT, image)), { recursive: true });
    cpSync(join(DOCS, image), join(DOCS_OUT, image));
  }
}

/** @type {esbuild.BuildOptions} */
const options = {
  absWorkingDir: ROOT,
  entryPoints: ["client/main.ts"],
  outfile: join(OUT, ADMIN, "app.js"),
  bundle: true,
  format: "iife",
  target: "es2022",
  sourcemap: true,
  // Icons are files under client/ui/icons/, inlined as text (the client test project mirrors this).
  loader: { ".svg": "text" },
  minify: !dev,
  define: { __DEV__: String(dev) },
  logLevel: "info",
  banner: {
    js: "// GENERATED by scripts/build-client.mjs from client/ — edit the source there, never this file.",
  },
  plugins: [
    {
      name: "emit-served-tree",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length > 0) {
            return;
          }
          try {
            emitServedTree();
          } catch (e) {
            console.error(`[client] ${e.message}`);
            if (!watchMode) {
              process.exit(1);
            }
          }
        });
      },
    },
  ],
};

if (checkMode) {
  sourceIndex();
  docsImages();
  await esbuild.build({ ...options, write: false, plugins: [], logLevel: "silent" });
  console.log("[client] served tree builds (checked, nothing written)");
} else if (watchMode) {
  const ctx = await esbuild.context(options);
  await ctx.watch();

  // public/ edits (the stylesheet, the index.html template, favicon, _headers) and docs/
  // edits (a recaptured image) need no bundling, only a re-emit. Watch the directories, not
  // files: an editor that saves by rename replaces the inode, which a file watch would
  // silently lose. Debounced, since one save can land as several events.
  let timer = null;
  const reemit = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        emitServedTree();
      } catch (e) {
        console.error(`[client] ${e.message}`);
      }
    }, 50);
  };
  watch(SRC, { recursive: true }, reemit);
  watch(DOCS, { recursive: true }, reemit);

  console.log(
    `[client] ${dev ? "dev" : "production"} build: watching client/ and public/, serving from dist/public`,
  );
} else {
  await esbuild.build(options);
}
