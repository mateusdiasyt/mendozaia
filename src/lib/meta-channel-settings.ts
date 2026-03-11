export interface MetaChannelConnection {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  instagramBusinessAccountId: string | null;
  instagramUsername: string | null;
  connectedAt: string;
  updatedAt: string;
}

export interface MetaChannelsSettings {
  activePageId: string | null;
  channels: MetaChannelConnection[];
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseMetaChannelsSettings(raw: unknown): MetaChannelsSettings {
  const fallback: MetaChannelsSettings = {
    activePageId: null,
    channels: [],
  };
  if (!raw || typeof raw !== "object") return fallback;

  const input = raw as Record<string, unknown>;
  const rawChannels = Array.isArray(input.channels) ? input.channels : [];
  const channels: MetaChannelConnection[] = rawChannels
    .map((item) => {
      const source = item as Record<string, unknown>;
      const pageId = normalizeString(source.pageId);
      const pageName = normalizeString(source.pageName);
      const pageAccessToken = normalizeString(source.pageAccessToken);
      if (!pageId || !pageAccessToken) return null;

      const instagramBusinessAccountId = normalizeString(
        source.instagramBusinessAccountId
      );
      const instagramUsername = normalizeString(source.instagramUsername);
      const connectedAt = normalizeString(source.connectedAt);
      const updatedAt = normalizeString(source.updatedAt);

      return {
        pageId,
        pageName: pageName || pageId,
        pageAccessToken,
        instagramBusinessAccountId: instagramBusinessAccountId || null,
        instagramUsername: instagramUsername || null,
        connectedAt: connectedAt || new Date().toISOString(),
        updatedAt: updatedAt || connectedAt || new Date().toISOString(),
      } satisfies MetaChannelConnection;
    })
    .filter((item): item is MetaChannelConnection => item !== null);

  const activePageIdRaw = normalizeString(input.activePageId);
  const activePageId = channels.some((channel) => channel.pageId === activePageIdRaw)
    ? activePageIdRaw
    : channels[0]?.pageId ?? null;

  return {
    activePageId,
    channels,
  };
}

export function toSafeMetaChannelView(
  settings: MetaChannelsSettings
): Array<{
  pageId: string;
  pageName: string;
  instagramBusinessAccountId: string | null;
  instagramUsername: string | null;
  isActive: boolean;
  connectedAt: string;
  updatedAt: string;
}> {
  return settings.channels.map((channel) => ({
    pageId: channel.pageId,
    pageName: channel.pageName,
    instagramBusinessAccountId: channel.instagramBusinessAccountId,
    instagramUsername: channel.instagramUsername,
    isActive: settings.activePageId === channel.pageId,
    connectedAt: channel.connectedAt,
    updatedAt: channel.updatedAt,
  }));
}

export function mergeMetaChannels(
  current: MetaChannelsSettings,
  incoming: MetaChannelConnection[]
): MetaChannelsSettings {
  const byPage = new Map<string, MetaChannelConnection>();
  for (const channel of current.channels) {
    byPage.set(channel.pageId, channel);
  }
  for (const channel of incoming) {
    byPage.set(channel.pageId, channel);
  }

  const channels = [...byPage.values()];
  const activePageId =
    current.activePageId && channels.some((c) => c.pageId === current.activePageId)
      ? current.activePageId
      : channels[0]?.pageId ?? null;

  return {
    activePageId,
    channels,
  };
}

