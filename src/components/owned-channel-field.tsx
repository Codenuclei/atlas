"use client";

import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { UserCircle, X } from "@phosphor-icons/react";
import { cn } from "@/components/ui";
import {
  channelAvatarUrl,
  parseChannelToken,
  parseOwnedChannels,
  platformFaviconUrl,
  serializeOwnedChannels,
  type OwnedChannel,
} from "@/lib/owned-channels";

function ChannelChip({
  channel,
  onRemove,
}: {
  channel: OwnedChannel;
  onRemove: () => void;
}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const avatar = channelAvatarUrl(channel);
  const favicon = platformFaviconUrl(channel.platform);

  return (
    <span
      className="group inline-flex h-5 max-w-[8.5rem] items-center gap-1 rounded-md bg-active/50 pl-0.5 pr-0.5"
      title={channel.raw}
    >
      <span className="relative size-[18px] shrink-0 overflow-hidden rounded-full bg-track">
        {avatar && !avatarFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt=""
            className="size-full object-cover"
            onError={() => setAvatarFailed(true)}
          />
        ) : (
          <span className="grid size-full place-items-center text-[8px] font-semibold uppercase text-faint">
            {channel.handle.slice(0, 1)}
          </span>
        )}
        {favicon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={favicon}
            alt=""
            className="absolute -right-px -bottom-px size-1.5 rounded-[1px] bg-elevated ring-1 ring-elevated"
          />
        ) : null}
      </span>
      <span className="truncate text-[10px] text-muted">{channel.handle}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${channel.handle}`}
        className="grid size-3.5 place-items-center rounded text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
      >
        <X size={8} weight="bold" />
      </button>
    </span>
  );
}

/**
 * Owned-channel field: paste YT/IG URLs or type handles,
 * with mini channel avatars and platform favicon badges.
 */
export function OwnedChannelField({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const [channels, setChannels] = useState<OwnedChannel[]>(() => parseOwnedChannels(value));
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const syncing = useRef(false);

  useEffect(() => {
    if (syncing.current) {
      syncing.current = false;
      return;
    }
    setChannels(parseOwnedChannels(value));
  }, [value]);

  function commit(next: OwnedChannel[]) {
    setChannels(next);
    syncing.current = true;
    onChange(serializeOwnedChannels(next));
  }

  function addTokens(tokens: string[]) {
    const next = [...channels];
    const seen = new Set(next.map((c) => c.id));
    for (const token of tokens) {
      const channel = parseChannelToken(token);
      if (!channel || seen.has(channel.id)) continue;
      seen.add(channel.id);
      next.push(channel);
    }
    if (next.length !== channels.length) commit(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === " ") {
      if (!draft.trim()) return;
      event.preventDefault();
      addTokens([draft]);
      setDraft("");
    } else if (event.key === "Backspace" && !draft && channels.length) {
      commit(channels.slice(0, -1));
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (!text) return;
    const looksLikeUrl = /youtube\.com|youtu\.be|instagram\.com/i.test(text);
    const looksLikeHandle = /^@?[A-Za-z0-9._]+$/.test(text.trim());
    if (looksLikeUrl || (looksLikeHandle && text.includes(","))) {
      event.preventDefault();
      addTokens(text.split(/[\s,;]+/));
      setDraft("");
    }
  }

  const placeholder = useMemo(
    () => (channels.length ? "add…" : "channel"),
    [channels.length],
  );

  return (
    <div
      role="group"
      aria-label="Owned channels"
      onClick={() => inputRef.current?.focus()}
      className={cn(
        "flex min-h-7 cursor-text flex-wrap items-center gap-1 rounded-md border border-stroke py-0.5 pl-1.5 pr-1.5",
        className,
      )}
    >
      <span className="grid size-5 shrink-0 place-items-center text-faint" aria-hidden="true">
        <UserCircle size={14} />
      </span>
      <span className="h-3.5 w-px shrink-0 bg-stroke" aria-hidden="true" />
      {channels.map((channel) => (
        <ChannelChip
          key={channel.id}
          channel={channel}
          onRemove={() => commit(channels.filter((c) => c.id !== channel.id))}
        />
      ))}
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value.replace(/^@/, ""))}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => {
          if (draft.trim()) {
            addTokens([draft]);
            setDraft("");
          }
        }}
        aria-label="Add owned channel"
        data-tip="Paste a YouTube or Instagram URL, or type a handle"
        placeholder={placeholder}
        className="tip tip-b h-5 min-w-[5.5rem] flex-1 bg-transparent text-xs placeholder:text-faint focus:outline-none"
      />
    </div>
  );
}
