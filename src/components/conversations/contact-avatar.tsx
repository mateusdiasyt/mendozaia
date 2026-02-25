"use client";

import { useState, useEffect } from "react";

interface ContactAvatarProps {
  /** sessionId da instância WhatsApp (whatsappSessions.sessionId) */
  sessionId: string;
  /** Telefone do contato */
  phone: string;
  /** Nome ou fallback para iniciais */
  displayName: string;
  /** Tamanho: sm (header), md (lista) */
  size?: "sm" | "md";
  /** Se true, usa conversationId em vez de sessionId+phone (para cache por conversa) */
  conversationId?: string;
  /** Número não lido para badge */
  unreadCount?: number;
  className?: string;
}

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

  useEffect(() => {
    const params = conversationId
      ? `conversationId=${conversationId}`
      : `sessionId=${encodeURIComponent(sessionId)}&phone=${encodeURIComponent(phone)}`;
    fetch(`/api/profile-picture?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.url) setProfileUrl(data.url);
      })
      .catch(() => {});
  }, [sessionId, phone, conversationId]);

  return (
    <div className={`relative shrink-0 ${className}`}>
      <div
        className={`flex items-center justify-center overflow-hidden rounded-full bg-[#00a884] font-medium text-white ${sizeClass}`}
      >
        {profileUrl ? (
          <img
            src={profileUrl}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
            onError={() => setProfileUrl(null)}
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
