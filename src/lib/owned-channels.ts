export type ChannelPlatform = "youtube" | "instagram" | "unknown";

export type OwnedChannel = {
  id: string;
  platform: ChannelPlatform;
  /** Handle without leading @ */
  handle: string;
  /** Original pasted token (URL or @handle) */
  raw: string;
};

const YT_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:@|c\/|user\/|channel\/)|youtu\.be\/)([A-Za-z0-9._-]+)/i;
const IG_RE =
  /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)/i;
const HANDLE_RE = /^@?([A-Za-z0-9._]{2,64})$/;

/** Split a free-text owned-channels string into tokens. */
export function splitChannelTokens(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Parse one token (URL or handle) into a channel chip. */
export function parseChannelToken(token: string): OwnedChannel | null {
  const t = token.trim();
  if (!t) return null;

  const yt = t.match(YT_RE);
  if (yt?.[1]) {
    const handle = yt[1];
    return {
      id: `yt:${handle.toLowerCase()}`,
      platform: "youtube",
      handle,
      raw: t,
    };
  }

  const ig = t.match(IG_RE);
  if (ig?.[1] && !["p", "reel", "reels", "stories", "explore"].includes(ig[1].toLowerCase())) {
    const handle = ig[1];
    return {
      id: `ig:${handle.toLowerCase()}`,
      platform: "instagram",
      handle,
      raw: t,
    };
  }

  const plain = t.match(HANDLE_RE);
  if (plain?.[1]) {
    const handle = plain[1];
    return {
      id: `any:${handle.toLowerCase()}`,
      platform: "unknown",
      handle,
      raw: t.startsWith("@") ? t : `@${handle}`,
    };
  }

  return null;
}

export function parseOwnedChannels(raw: string): OwnedChannel[] {
  const seen = new Set<string>();
  const out: OwnedChannel[] = [];
  for (const token of splitChannelTokens(raw)) {
    const channel = parseChannelToken(token);
    if (!channel || seen.has(channel.id)) continue;
    seen.add(channel.id);
    out.push(channel);
  }
  return out;
}

/** Serialize chips back into the planner-facing string. */
export function serializeOwnedChannels(channels: OwnedChannel[]): string {
  return channels.map((c) => c.raw).join(", ");
}

/** Channel avatar — unavatar for YT/IG, null for unknown. */
export function channelAvatarUrl(channel: OwnedChannel): string | null {
  if (channel.platform === "youtube") {
    return `https://unavatar.io/youtube/${encodeURIComponent(channel.handle)}?fallback=false`;
  }
  if (channel.platform === "instagram") {
    return `https://unavatar.io/instagram/${encodeURIComponent(channel.handle)}?fallback=false`;
  }
  return null;
}

/** Tiny platform favicon for the badge. */
export function platformFaviconUrl(platform: ChannelPlatform): string | null {
  if (platform === "youtube") {
    return "https://www.google.com/s2/favicons?domain=youtube.com&sz=32";
  }
  if (platform === "instagram") {
    return "https://www.google.com/s2/favicons?domain=instagram.com&sz=32";
  }
  return null;
}
