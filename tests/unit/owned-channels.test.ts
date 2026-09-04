import { describe, expect, it } from "vitest";
import {
  channelAvatarUrl,
  parseChannelToken,
  parseOwnedChannels,
  platformFaviconUrl,
  serializeOwnedChannels,
  splitChannelTokens,
} from "@/lib/owned-channels";

describe("splitChannelTokens", () => {
  it("splits on whitespace, commas, and semicolons", () => {
    expect(
      splitChannelTokens("  @brand, other.channel; third\tfourth "),
    ).toEqual(["@brand", "other.channel", "third", "fourth"]);
    expect(splitChannelTokens("   ")).toEqual([]);
  });
});

describe("parseChannelToken", () => {
  it("parses youtube URLs in all supported shapes", () => {
    expect(parseChannelToken("https://www.youtube.com/@ExampleBrand")).toMatchObject({
      id: "yt:examplebrand",
      platform: "youtube",
      handle: "ExampleBrand",
    });
    expect(parseChannelToken("https://youtube.com/channel/UCabc")).toMatchObject({
      id: "yt:ucabc",
    });
    expect(parseChannelToken("https://youtu.be/ChannelName")).toMatchObject({
      id: "yt:channelname",
    });
    // youtu.be/@handles are not channel identifiers.
    expect(parseChannelToken("https://youtu.be/@short")).toBeNull();
  });

  it("parses instagram profiles but not post/reel/explore URLs", () => {
    expect(parseChannelToken("https://www.instagram.com/example.brand")).toMatchObject({
      id: "ig:example.brand",
      platform: "instagram",
    });
    expect(parseChannelToken("https://www.instagram.com/p/abc/")).toBeNull();
    expect(parseChannelToken("https://www.instagram.com/reels/roll/")).toBeNull();
  });

  it("parses bare handles and normalizes the raw form", () => {
    expect(parseChannelToken("example.brand")).toMatchObject({
      id: "any:example.brand",
      platform: "unknown",
      raw: "@example.brand",
    });
    expect(parseChannelToken("@Example")).toMatchObject({
      id: "any:example",
      raw: "@Example",
    });
    expect(parseChannelToken("e")).toBeNull(); // under the 2-char minimum
    expect(parseChannelToken("https://www.not-a-social.site/x")).toBeNull();
  });
});

describe("parseOwnedChannels", () => {
  it("dedupes repeated forms of the same channel", () => {
    const channels = parseOwnedChannels(
      "https://www.youtube.com/@brand, https://youtube.com/@Brand",
    );
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({ id: "yt:brand", platform: "youtube" });
  });

  it("keeps an unresolvable bare handle alongside the platform chip", () => {
    const channels = parseOwnedChannels("https://www.youtube.com/@brand, @brand");
    expect(channels.map((c) => c.platform)).toEqual(["youtube", "unknown"]);
  });

  it("keeps distinct platforms even with overlapping handles", () => {
    const channels = parseOwnedChannels("@same, https://youtube.com/@same");
    expect(channels.map((c) => c.platform)).toEqual(["unknown", "youtube"]);
  });
});

describe("serializeOwnedChannels", () => {
  it("rejoins original tokens as the planner-facing string", () => {
    const channels = parseOwnedChannels("a.channel https://www.youtube.com/@brand");
    expect(serializeOwnedChannels(channels)).toBe(
      "@a.channel, https://www.youtube.com/@brand",
    );
  });
});

describe("channel assets", () => {
  it("builds unavatar urls for known platforms and null for unknown", () => {
    expect(
      channelAvatarUrl({ id: "yt:x", platform: "youtube", handle: "X Y", raw: "" }),
    ).toBe("https://unavatar.io/youtube/X%20Y?fallback=false");
    expect(
      channelAvatarUrl({ id: "ig:x", platform: "instagram", handle: "x", raw: "" }),
    ).toBe("https://unavatar.io/instagram/x?fallback=false");
    expect(
      channelAvatarUrl({ id: "any:x", platform: "unknown", handle: "x", raw: "" }),
    ).toBeNull();
  });

  it("returns favicon urls only for known platforms", () => {
    expect(platformFaviconUrl("youtube")).toContain("youtube.com");
    expect(platformFaviconUrl("instagram")).toContain("instagram.com");
    expect(platformFaviconUrl("unknown")).toBeNull();
  });
});
