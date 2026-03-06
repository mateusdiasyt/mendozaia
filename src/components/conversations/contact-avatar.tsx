"use client";

import { useEffect, useMemo, useState } from "react";

interface ContactAvatarProps {
  /** sessionId da instancia WhatsApp (whatsappSessions.sessionId) */
  sessionId: string;
  /** Telefone do contato */
  phone: string;
  /** Nome ou fallback para iniciais */
  displayName: string;
  /** Tamanho: sm (header), md (lista) */
  size?: "sm" | "md";
  /** Se true, usa conversationId em vez de sessionId+phone (para cache por conversa) */
  conversationId?: string;
  /** Numero nao lido para badge */
  unreadCount?: number;
  className?: string;
}

const AVATAR_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas
const memoryAvatarCache = new Map<string, { url: string; cachedAt: number }>();

function getInitials(name: string): string {
  if (!name) return "?";
  const parts = name.replace(/[^a-zA-Z0-9\s]/g, "").split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  }
  if (parts[0]?.length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return parts[0]?.[0]?.toUpperCase() ?? "?";
}

function buildCacheKey(conversationId?: string, sessionId?: string, phone?: string): string {
  if (conversationId) return `conversation:${conversationId}`;
  return `session:${sessionId ?? ""}:phone:${phone ?? ""}`;
}

function readLocalCache(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`avatar:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { url?: string; cachedAt?: number };
    if (!parsed.url || !parsed.cachedAt) return null;
    if (Date.now() - parsed.cachedAt > AVATAR_CACHE_TTL_MS) {
      localStorage.removeItem(`avatar:${key}`);
      return null;
    }
    return parsed.url;
  } catch {
    return null;
  }
}

function writeLocalCache(key: string, url: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      `avatar:${key}`,
      JSON.stringify({ url, cachedAt: Date.now() })
    );
  } catch {
    // ignore cache write failure
  }
}

export function ContactAvatar({
  sessionId,
  phone,
  displayName,
  size = "md",
  conversationId,
  unreadCount = 0,
  className = "",
}: ContactAvatarProps) {
  const [profileUrl, setProfileUrl] = useState<string | null>(null);

  const sizeClass = size === "sm" ? "h-10 w-10 text-sm" : "h-12 w-12 text-lg";
  const initials = getInitials(displayName);
  const cacheKey = useMemo(
    () => buildCacheKey(conversationId, sessionId, phone),
    [conversationId, sessionId, phone]
  );
  const effectiveProfileUrl = profileUrl;

  useEffect(() => {
    if (profileUrl) {
      return;
    }
    let cancelled = false;

    const memoryCached = memoryAvatarCache.get(cacheKey);
    if (memoryCached && Date.now() - memoryCached.cachedAt <= AVATAR_CACHE_TTL_MS) {
      queueMicrotask(() => {
        if (!cancelled) setProfileUrl(memoryCached.url);
      });
      return () => {
        cancelled = true;
      };
    }

    const localCached = readLocalCache(cacheKey);
    if (localCached) {
      memoryAvatarCache.set(cacheKey, { url: localCached, cachedAt: Date.now() });
      queueMicrotask(() => {
        if (!cancelled) setProfileUrl(localCached);
      });
      return () => {
        cancelled = true;
      };
    }

    const params = conversationId
      ? `conversationId=${conversationId}`
      : `sessionId=${encodeURIComponent(sessionId)}&phone=${encodeURIComponent(phone)}`;

    fetch(`/api/profile-picture?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data?.url) return;
        const url = String(data.url);
        if (!cancelled) setProfileUrl(url);
        memoryAvatarCache.set(cacheKey, { url, cachedAt: Date.now() });
        writeLocalCache(cacheKey, url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId, phone, conversationId, cacheKey, profileUrl]);

  return (
    <div className={`relative shrink-0 ${className}`}>
      <div
        className={`flex items-center justify-center overflow-hidden rounded-full bg-[#00a884] font-medium text-white ${sizeClass}`}
      >
        {effectiveProfileUrl ? (
          <img
            src={effectiveProfileUrl}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
            onError={() => {
              setProfileUrl(null);
              memoryAvatarCache.delete(cacheKey);
            }}
          />
        ) : (
          initials
        )}
      </div>
      {unreadCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#00a884] px-1.5 text-xs font-medium text-white">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </div>
  );
}
