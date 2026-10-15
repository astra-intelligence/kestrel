// A post's two addresses (SPEC §4, §5): the unlisted link every email carries, which never
// changes, and the archive address, which answers only while the post is listed and is
// reserved, numbered if taken, once it has been public.

import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "../src/env";
import { clearFakeOutbox, fakeOutbox } from "../src/providers/fake";
import { sweep } from "../src/send/sweep";
import { resetDatabase, seedConfirmed, setRow } from "./support/fixtures";
import { AUTH, base, JSON_AUTH, readJson } from "./support/http";

beforeEach(async () => {
  await resetDatabase();
  clearFakeOutbox();
  await seedConfirmed("a@example.com");
});

const DAY = 86_400_000;
/** The app's origin, which every link the app builds names (the archive's is the same here). */
const ORIGIN = getConfig(env).appOrigin;

const call = (method: string, path: string, body?: unknown) =>
  SELF.fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? AUTH : JSON_AUTH,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function makeDraft(subject: string, extra: Record<string, unknown> = {}): Promise<string> {
  const created = await readJson(
    await call("POST", "/api/posts", { subject, markdown: `# ${subject}\n\nbody`, ...extra }),
  );
  return created.post.id;
}

const read = async (id: string) => readJson(await call("GET", `/api/posts/${id}`));

const setListing = (id: string, body: unknown) => call("PUT", `/api/posts/${id}/listing`, body);

async function schedule(id: string, emailOnly = false): Promise<string> {
  const res = await call("POST", `/api/posts/${id}/schedule`, {
    fire_at: new Date(Date.now() + DAY).toISOString(),
    email_only: emailOnly,
  });
  expect(res.status).toBe(201);
  return (await readJson(res)).send.id;
}

/** Make a scheduled send due and run the sweep, as its fire time would. */
async function fire(sendId: string): Promise<void> {
  await setRow(sendId, { fire_at: Date.now() - 1000 });
  await sweep(env);
}

/** A post sent through the sweep, listed or email only. */
async function sendPost(subject: string, emailOnly = false) {
  const id = await makeDraft(subject);
  const sendId = await schedule(id, emailOnly);
  await fire(sendId);
  const { post } = await read(id);
  return { id, sendId, post };
}

const get = (path: string) => SELF.fetch(`${base}${path}`, { redirect: "manual" });

describe("every email carries the post's unlisted link (SPEC §5)", () => {
  it("as view in browser in a test and in the send, and never the archive address", async () => {
    const id = await makeDraft("Barn Owls");
    const { post } = await read(id);
    const link = `${ORIGIN}/email/${post.unlisted_token}`;
    expect(post.unlisted_token).toMatch(/^[0-9a-f]{32}$/);

    await call("POST", `/api/posts/${id}/test`, { to: "me@example.com" });
    const sendId = await schedule(id);
    await fire(sendId);
    const test = fakeOutbox().find((m) => m.to === "me@example.com")!;
    const sent = fakeOutbox().find((m) => m.to === "a@example.com")!;
    for (const email of [test, sent]) {
      expect(email.html).toContain(`href="${link}"`);
      expect(email.text).toContain(`View in browser: ${link}`);
      expect(email.html).not.toContain("/archive/");
    }
  });

  it("is made with the post and never changes, whatever its subject, address, or listing", async () => {
    const id = await makeDraft("First Subject");
    const before = (await read(id)).post;
    const saved = await readJson(
      await call("PUT", `/api/posts/${id}`, {
        subject: "Second Subject",
        slug: "elsewhere",
        base_revision: before.current_revision,
      }),
    );
    await setListing(id, { email_only: true });
    expect(saved.post.unlisted_token).toBe(before.unlisted_token);
    expect((await read(id)).post.unlisted_token).toBe(before.unlisted_token);
    const other = (await read(await makeDraft("First Subject"))).post;
    expect(other.unlisted_token).not.toBe(before.unlisted_token);
  });
});

describe("what the unlisted link opens follows the post (SPEC §5)", () => {
  it("answers Nothing here yet before the send starts, as an unknown link does", async () => {
    const id = await makeDraft("Not Yet");
    const { post } = await read(id);
    await schedule(id);
    for (const token of [post.unlisted_token, "0000"]) {
      const res = await get(`/email/${token}`);
      expect(res.status).toBe(404);
      expect(await res.text()).toContain("Nothing here yet");
    }
  });

  it("forwards a listed post, temporarily, to its archive address", async () => {
    const { post } = await sendPost("Listed Owls");
    const res = await get(`/email/${post.unlisted_token}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/archive/listed-owls`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await get("/archive/listed-owls")).status).toBe(200);
  });

  it("is an email-only post's page, unindexed", async () => {
    const { post } = await sendPost("Quiet Gulls", true);
    const res = await get(`/email/${post.unlisted_token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(await res.text()).toContain(">Quiet Gulls</h1>");
  });
});

describe("the archive address (SPEC §4, §5)", () => {
  it("is reserved when a listed send starts, and stops following the subject", async () => {
    const id = await makeDraft("Spring Update");
    const sendId = await schedule(id);
    expect((await read(id)).post).toMatchObject({ slug_reserved: false, slug_auto: true });
    await fire(sendId);
    expect((await read(id)).post).toMatchObject({
      slug: "spring-update",
      slug_reserved: true,
      slug_auto: false,
    });
  });

  it("can change while the post is scheduled, since no email carries it", async () => {
    const id = await makeDraft("Spring Update");
    const sendId = await schedule(id);
    const res = await setListing(id, { slug: "the-spring-letter" });
    expect(res.status).toBe(200);
    expect((await readJson(res)).post).toMatchObject({
      slug: "the-spring-letter",
      slug_auto: false,
    });
    await fire(sendId);
    expect((await get("/archive/the-spring-letter")).status).toBe(200);
    expect((await get("/archive/spring-update")).status).toBe(404);
  });

  it("is numbered when it is reserved, not before, if another post holds it", async () => {
    const first = await makeDraft("Spring Update");
    const second = await makeDraft("Spring Update");
    // Two drafts may want one address: neither is numbered yet.
    expect((await read(second)).post.slug).toBe("spring-update");
    await fire(await schedule(first));
    // The second still asks for it, and says what it would take.
    const waiting = await read(second);
    expect(waiting.post.slug).toBe("spring-update");
    expect(waiting.archive_slug).toBe("spring-update-2");
    await fire(await schedule(second));
    expect((await read(second)).post).toMatchObject({
      slug: "spring-update-2",
      slug_reserved: true,
    });
    expect((await get("/archive/spring-update-2")).status).toBe(200);
  });

  it("is permanent once public: a change to it is refused, and naming it again is fine", async () => {
    const { id } = await sendPost("Kept Address");
    for (const body of [{ slug: "moved" }, { slug_auto: true }]) {
      const res = await setListing(id, body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect((await readJson(res)).error).toBe("slug_permanent");
    }
    const same = await setListing(id, { slug: "kept-address" });
    expect(same.status).toBe(200);
    expect((await readJson(same)).changed).toBe(false);
  });

  it("is taken down by Make email only, stays reserved, and comes back with Add to archive", async () => {
    const { id, post } = await sendPost("Owls");
    const off = await readJson(await setListing(id, { email_only: true }));
    expect(off.changed).toBe(true);
    expect(off.post).toMatchObject({ email_only: true, slug: "owls", slug_reserved: true });
    // Shared links stop working; the email's link opens the page.
    expect((await get("/archive/owls")).status).toBe(404);
    expect((await get(`/email/${post.unlisted_token}`)).status).toBe(200);

    // Another post can't take the address meanwhile.
    const { post: rival } = await sendPost("Owls");
    expect(rival.slug).toBe("owls-2");

    const on = await readJson(await setListing(id, { email_only: false }));
    expect(on.post).toMatchObject({ email_only: false, slug: "owls" });
    expect((await get("/archive/owls")).status).toBe(200);
    expect((await get(`/email/${post.unlisted_token}`)).headers.get("location")).toBe(
      `${ORIGIN}/archive/owls`,
    );
  });

  it("is set and reserved by Add to archive for a post never listed", async () => {
    await sendPost("Taken Name");
    const { id, post } = await sendPost("Quiet One", true);
    expect(post.slug_reserved).toBe(false);
    const res = await readJson(await setListing(id, { email_only: false, slug: "taken-name" }));
    // The address another post holds is numbered, as at a send's start.
    expect(res.post).toMatchObject({
      slug: "taken-name-2",
      slug_reserved: true,
      email_only: false,
    });
    expect(res.archive_slug).toBe("taken-name-2");
    expect((await get("/archive/taken-name-2")).status).toBe(200);
  });

  it("answers whatever the listing for a post whose email carries it, as one sent before unlisted links does", async () => {
    const { id, sendId } = await sendPost("Older Post");
    // A send frozen before unlisted links: its email links the archive address.
    await setRow(sendId, { web_link: "archive" });
    await setListing(id, { email_only: true });
    const res = await get("/archive/older-post");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const view = readJson(await call("GET", `/api/sends/${sendId}`));
    expect((await view).send.links.archive).toBe(`${ORIGIN}/archive/older-post`);
  });

  it("is reported on a send's view only while it answers, beside the unlisted link", async () => {
    const { id, sendId, post } = await sendPost("Reported");
    const view = async () => (await readJson(await call("GET", `/api/sends/${sendId}`))).send;
    expect((await view()).links).toMatchObject({
      archive: `${ORIGIN}/archive/reported`,
      unlisted: `${ORIGIN}/email/${post.unlisted_token}`,
    });
    await setListing(id, { email_only: true });
    expect((await view()).links).toMatchObject({
      archive: null,
      unlisted: `${ORIGIN}/email/${post.unlisted_token}`,
    });
  });
});
