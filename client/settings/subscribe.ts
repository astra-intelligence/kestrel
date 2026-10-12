// Settings' Ways to subscribe section: the public subscribe page's address and a form to
// paste into the publisher's own site. Both post to the public /subscribe and start the
// double opt-in, never an auto-confirm (I1).

import { copyButton, wireCopy } from "../ui/copy";
import { $, $$ } from "../ui/dom";
import { escapeHtml, type Html, html, setHtml } from "../ui/html";
import { type IconName, icon } from "../ui/icons";
import { chip, type SectionHandle, type SettingsPage, secHead } from "./page";

type EmbedMode = "plain" | "styled";

const EMBED_HINTS: Record<EmbedMode, string> = {
  styled: "Carries its own styles, so it pastes in anywhere.",
  plain: "Bare markup. Style it to match your site.",
};

/** The embed's heading: "Subscribe to <name>", or "Subscribe" with no name (SPEC §9). */
function embedHeading(name: string): string {
  return name ? `Subscribe to ${name}` : "Subscribe";
}

/** The snippet a publisher pastes into their own page. It is text here (shown in a code
 *  block and copied), escaped for the page it will land in. */
export function buildEmbed(mode: EmbedMode, name: string, appOrigin: string): string {
  const heading = escapeHtml(embedHeading(name));
  const action = `${escapeHtml(appOrigin)}/subscribe`;
  if (mode === "styled") {
    return (
      `<form action="${action}" method="post" style="max-width:420px;font:15px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif">\n` +
      `  <div style="font-weight:600;margin-bottom:6px">${heading}</div>\n` +
      `  <div style="display:flex;gap:8px;flex-wrap:wrap">\n` +
      `    <input type="email" name="email" required placeholder="you@example.com" aria-label="Email address" style="flex:1 1 200px;padding:10px 12px;border:1px solid #d4d4d8;border-radius:8px;font:inherit">\n` +
      `    <button type="submit" style="padding:10px 18px;border:0;border-radius:8px;background:#18181b;color:#fff;font:inherit;font-weight:600;cursor:pointer">Subscribe</button>\n` +
      `  </div>\n` +
      `  <p style="margin:8px 0 0;font-size:13px;color:#71717a">Double opt-in: we'll email a confirmation link. Unsubscribe anytime.</p>\n` +
      `</form>`
    );
  }
  return (
    `<form action="${action}" method="post">\n` +
    `  <label>\n` +
    `    ${heading}\n` +
    `    <input type="email" name="email" placeholder="you@example.com" required>\n` +
    `  </label>\n` +
    `  <button type="submit">Subscribe</button>\n` +
    `</form>`
  );
}

/** The snippet as it will look on the publisher's site: a mockup, inert. */
function embedPreview(mode: EmbedMode, name: string): Html {
  const heading = embedHeading(name);
  if (mode === "styled") {
    return html`<form class="set-pf-styled"><span class="l">${heading}</span><div class="rowf"><input type="email" placeholder="you@example.com" disabled><button type="button" class="sub-btn" tabindex="-1">Subscribe</button></div><p class="set-pf-fine">Double opt-in: we’ll email a confirmation link.</p></form>`;
  }
  return html`<form class="set-pf-plain"><label>${heading}</label><input type="email" placeholder="you@example.com" disabled><button type="button" tabindex="-1">Subscribe</button></form>`;
}

function appOriginOf(page: SettingsPage): string {
  return page.data.deployment.appOrigin || location.origin;
}

/** The page's line names the publication only when it has a name, since the page then
 *  reads "Subscribe" (SPEC §9). */
function pageLine(name: string): string {
  return name
    ? "A public page with your publication’s name and a sign-up form ready to go."
    : "A public page with a sign-up form ready to go.";
}

/** One way to subscribe, a band of the section's card: its glyph and title, its line,
 *  then what it offers. The two ways share this head so they read as parallel options. */
function way(glyph: IconName, title: string, line: Html, body: Html): Html {
  return html`<div class="set-way"><div class="set-way-head"><h3 class="set-way-title">${icon(glyph)}${title}</h3><p class="set-way-line">${line}</p></div>${body}</div>`;
}

export function subscribeSection(page: SettingsPage): Html {
  const subscribeUrl = `${appOriginOf(page)}/subscribe`;
  return html`
    <section class="set-sec set-sec-subscribe">
      ${secHead("Ways to subscribe", chip("copyout", "Copy-out"))}
      <p class="set-lede">Two ways for readers to join your list. Either way, a reader is added only once they confirm by email.</p>
      <div class="set-card">
      ${way(
        "link",
        "Share the page",
        html`<span id="subscribePageLine"></span>`,
        html`<div class="set-way-body set-way-addr"><code class="set-addr">${subscribeUrl}</code>${copyButton(subscribeUrl, "Copy the subscribe page's address")}<a class="ghost-link" href="${subscribeUrl}" target="_blank" rel="noopener">Open&nbsp;↗</a></div>`,
      )}
      ${way(
        "code",
        "Embed a form",
        html`Put a sign-up form on another site you own.`,
        html`<div class="set-preview-bar set-embed-bar"><span class="set-wtog" role="group" aria-label="Snippet style">
            <button type="button" class="wtog-btn" data-embed="plain" aria-pressed="true">Plain HTML</button>
            <button type="button" class="wtog-btn" data-embed="styled" aria-pressed="false">Styled</button>
          </span></div>
          <div class="set-embed">
            <div class="set-embed-preview" id="embedPreview"></div>
            <div class="set-embed-code" id="embedBlock"></div>
          </div>`,
      )}
      </div>
    </section>`;
}

/** The snippet beside its form: the variant's hint and its Copy on the head line, so the
 *  toggle's name isn't said twice (DESIGN §5). */
function embedCode(mode: EmbedMode, code: string): Html {
  const variant = mode === "styled" ? "Styled" : "Plain HTML";
  return html`<div class="set-embed-head"><span class="set-embed-hint" id="embedHint">${EMBED_HINTS[mode]}</span>${copyButton(code, `Copy the ${variant} form`)}</div><pre><code>${code}</code></pre>`;
}

/** The Plain/Styled toggle drives the code, the hint, the rendered preview, and the Copy
 *  payload; the name follows the live identity field. */
export function mountSubscribe(root: HTMLElement, page: SettingsPage): SectionHandle {
  const appOrigin = appOriginOf(page);
  const blockEl = $("#embedBlock", root);
  const previewEl = $("#embedPreview", root);
  const lineEl = $("#subscribePageLine", root);
  let mode: EmbedMode = "plain";
  const name = () => page.state.name || page.fromDisplay;
  const rebuild = () => {
    setHtml(blockEl, embedCode(mode, buildEmbed(mode, name(), appOrigin)));
    setHtml(previewEl, embedPreview(mode, name()));
    lineEl.textContent = pageLine(name());
  };
  const modeButtons = $$("[data-embed]", root);
  for (const b of modeButtons) {
    b.onclick = () => {
      mode = b.dataset.embed === "styled" ? "styled" : "plain";
      for (const o of modeButtons) {
        o.setAttribute("aria-pressed", String(o.dataset.embed === mode));
      }
      rebuild();
    };
  }
  wireCopy($(".set-sec-subscribe", root));
  rebuild();
  // The page repaints every section on any change, but the section shows only the name:
  // rebuilt for anything else, its Copy would lose a check it had just shown.
  let shownName = name();
  return {
    repaint() {
      if (name() !== shownName) {
        shownName = name();
        rebuild();
      }
    },
  };
}
