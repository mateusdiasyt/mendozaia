"use client";

import { useEffect } from "react";

/** Sincroniza webhooks (incl. PRESENCE_UPDATE) para sessões existentes ao carregar a página. */
export function SyncWebhooksOnLoad({
  sessionIds,
}: {
  sessionIds: string[];
}) {
  useEffect(() => {
    for (const sessionId of sessionIds) {
      fetch(`/api/whatsapp/sync-status/${sessionId}`, { method: "POST" }).catch(
        () => {}
      );
    }
  }, [sessionIds]);
  return null;
}
