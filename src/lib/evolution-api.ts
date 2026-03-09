/**
 * Cliente para Evolution API.
 * Centraliza chamadas à API do WhatsApp.
 */

const getBaseUrl = () => {
  const url = process.env.WHATSAPP_API_URL;
  if (!url) throw new Error("WHATSAPP_API_URL não configurada");
  return url.replace(/\/$/, "");
};

const getHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (apiKey) {
    headers["apikey"] = apiKey;
  }
  return headers;
};

const WEBHOOK_EVENTS = [
  "MESSAGES_UPSERT",
  "CONNECTION_UPDATE",
  "QRCODE_UPDATED",
  "PRESENCE_UPDATE",
] as const;

export async function createInstance(instanceName: string, webhookUrl?: string) {
  const baseUrl = getBaseUrl();
  const body = {
    instanceName,
    integration: "WHATSAPP-BAILEYS" as const,
    qrcode: true,
    webhook: webhookUrl
      ? {
          url: webhookUrl,
          events: [...WEBHOOK_EVENTS],
        }
      : undefined,
  };

  const res = await fetch(`${baseUrl}/instance/create`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err?.response?.message?.[0] ?? err?.error ?? `Erro ${res.status}`
    );
  }

  return res.json();
}

export async function connectInstance(instanceName: string) {
  const baseUrl = getBaseUrl();
  const res = await fetch(
    `${baseUrl}/instance/connect/${instanceName}`,
    {
      method: "GET",
      headers: getHeaders(),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { status?: number; response?: { message?: string[] }; error?: string };
    const error = new Error(
      err?.response?.message?.[0] ?? err?.error ?? `Erro ${res.status}`
    ) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }

  const data = (await res.json()) as { code?: string; pairingCode?: string };
  return data;
}

export async function fetchInstanceStatus(instanceName: string) {
  const baseUrl = getBaseUrl();
  const res = await fetch(
    `${baseUrl}/instance/connectionState/${instanceName}`,
    {
      method: "GET",
      headers: getHeaders(),
    }
  );

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as { instance?: { state?: string } };
  return data?.instance?.state ?? null;
}

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function extractPhoneCandidate(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const source = payload as Record<string, unknown>;

  const candidates: unknown[] = [
    source.number,
    source.phone,
    source.owner,
    source.wid,
    source.jid,
    source.wuid,
    (source.instance as Record<string, unknown> | undefined)?.number,
    (source.instance as Record<string, unknown> | undefined)?.phone,
    (source.instance as Record<string, unknown> | undefined)?.owner,
    (source.instance as Record<string, unknown> | undefined)?.wid,
    (source.instance as Record<string, unknown> | undefined)?.jid,
    (source.instance as Record<string, unknown> | undefined)?.wuid,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const withoutSuffix = candidate.replace("@s.whatsapp.net", "");
    const digits = normalizeDigits(withoutSuffix);
    if (digits.length >= 10 && digits.length <= 15) return digits;
  }

  return null;
}

export async function fetchInstanceConnectionInfo(instanceName: string): Promise<{
  state: string | null;
  phoneNumber: string | null;
}> {
  const baseUrl = getBaseUrl();
  const res = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, {
    method: "GET",
    headers: getHeaders(),
  });

  if (!res.ok) {
    return { state: null, phoneNumber: null };
  }

  const data = (await res.json()) as Record<string, unknown>;
  const state =
    ((data.instance as Record<string, unknown> | undefined)?.state as string | undefined) ??
    (typeof data.state === "string" ? data.state : null);
  const phoneNumber = extractPhoneCandidate(data);

  return { state: state ?? null, phoneNumber };
}

export async function fetchProfilePictureUrl(
  instanceName: string,
  number: string
): Promise<string | null> {
  const baseUrl = getBaseUrl();
  const cleanNumber = number.replace(/\D/g, "");
  const res = await fetch(
    `${baseUrl}/chat/fetchProfilePictureUrl/${instanceName}`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ number: cleanNumber }),
    }
  );

  if (!res.ok) return null;

  const data = (await res.json()) as { profilePictureUrl?: string };
  return data?.profilePictureUrl ?? null;
}

/** Atualiza o webhook de uma instância existente (para adicionar PRESENCE_UPDATE, etc.) */
export async function setInstanceWebhook(
  instanceName: string,
  webhookUrl: string
): Promise<void> {
  const baseUrl = getBaseUrl();
  const res = await fetch(
    `${baseUrl}/webhook/set/${instanceName}`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        url: webhookUrl,
        events: [...WEBHOOK_EVENTS],
        enabled: true,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.warn("[evolution-api] setWebhook failed:", err);
  }
}
