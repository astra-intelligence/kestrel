import { describe, expect, it } from "vitest";
import { actorLabel, sendActedBy, whoActed } from "./who_acted";

describe("whoActed (SPEC §11, Who acted)", () => {
  it("shows a person in the editor alone", () => {
    expect(whoActed("you@example.com", "editor")).toBe("you@example.com");
  });

  it("names the client a person came through by its own name, or as it named itself", () => {
    expect(whoActed("you@example.com", "claude-code")).toBe("you@example.com via Claude Code");
    expect(whoActed("you@example.com", "my-script")).toBe("you@example.com via my-script");
  });

  it("shows a person whose client named nothing as through the API", () => {
    expect(whoActed("you@example.com", null)).toBe("you@example.com via the API");
  });

  it("shows a service token as automation whatever the client, and nobody as nothing", () => {
    expect(whoActed("service", null)).toBe("a service token");
    expect(whoActed("service", "claude-code")).toBe("a service token");
    expect(whoActed(null, "editor")).toBeNull();
  });
});

describe("actorLabel (SPEC §11, Who acted)", () => {
  it("reads a person as whoActed does, with their client", () => {
    expect(actorLabel({ kind: "human", email: "you@example.com", client: "editor" })).toBe(
      "you@example.com",
    );
    expect(actorLabel({ kind: "human", email: "you@example.com", client: "claude-code" })).toBe(
      "you@example.com via Claude Code",
    );
    expect(actorLabel({ kind: "human", email: "you@example.com", client: null })).toBe(
      "you@example.com via the API",
    );
  });

  it("reads a service token by its name where it has one, never as a person", () => {
    expect(actorLabel({ kind: "service", token_id: "ci.access", client: null })).toBe(
      "the service token ci.access",
    );
    expect(actorLabel({ kind: "service", client: null })).toBe("a service token");
  });
});

describe("sendActedBy (SPEC §6, §11)", () => {
  const you = { kind: "human", email: "you@example.com", client: "editor" } as const;

  it("names each act recorded on a send, in the order they happen", () => {
    expect(
      sendActedBy({
        scheduled_by: { kind: "service", token_id: "ci.access", client: null },
        moved_by: { kind: "human", email: "you@example.com", client: "claude-code" },
        canceled_by: you,
        resolved_by: null,
      }),
    ).toBe(
      "Scheduled by the service token ci.access · moved by you@example.com via Claude Code · canceled by you@example.com",
    );
  });

  it("leads with the first act recorded, and says nothing when none is", () => {
    expect(sendActedBy({ scheduled_by: null, moved_by: you })).toBe("Moved by you@example.com");
    expect(
      sendActedBy({ scheduled_by: null, moved_by: null, canceled_by: null, resolved_by: null }),
    ).toBeNull();
    expect(sendActedBy({})).toBeNull();
  });
});
