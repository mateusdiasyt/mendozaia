const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v23.0";

function metaGraphUrl(path: string): string {
  const clean = path.startsWith("/") ? path.slice(1) : path;
  return `https://graph.facebook.com/${META_GRAPH_VERSION}/${clean}`;
}

function ensureMetaConfig(): { appId: string; appSecret: string } {
  const appId = process.env.META_APP_ID?.trim() ?? "";
  const appSecret = process.env.META_APP_SECRET?.trim() ?? "";
  if (!appId || !appSecret) {
    throw new Error("META_APP_ID ou META_APP_SECRET nao configurado.");
  }
  return { appId, appSecret };
}

async function fetchJson<T>(
  input: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input, init);
  const json = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!res.ok) {
    const msg =
      json?.error?.message ??
      `Erro Meta Graph (${res.status})`;
    throw new Error(msg);
  }
  return json as T;
}

export interface MetaManagedPage {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  instagramBusinessAccountId: string | null;
  instagramUsername: string | null;
}

export function getMetaOAuthUrl(params: {
  redirectUri: string;
  state: string;
}): string {
  const { appId } = ensureMetaConfig();
  const scopes = [
    "pages_show_list",
    "pages_messaging",
    "pages_manage_metadata",
    "instagram_basic",
    "instagram_manage_messages",
  ].join(",");

  const url = new URL("https://www.facebook.com/dialog/oauth");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("response_type", "code");
  return url.toString();
}

export async function exchangeCodeForUserToken(params: {
  code: string;
  redirectUri: string;
}): Promise<string> {
  const { appId, appSecret } = ensureMetaConfig();
  const url = new URL(metaGraphUrl("oauth/access_token"));
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code", params.code);

  const data = await fetchJson<{ access_token?: string }>(url.toString(), {
    method: "GET",
    cache: "no-store",
  });

  const token = data.access_token?.trim();
  if (!token) throw new Error("Meta nao retornou user access token.");
  return token;
}

export async function fetchManagedPages(
  userAccessToken: string
): Promise<MetaManagedPage[]> {
  const url = new URL(metaGraphUrl("me/accounts"));
  url.searchParams.set(
    "fields",
    "id,name,access_token,instagram_business_account{id,username},connected_instagram_account{id,username}"
  );
  url.searchParams.set("access_token", userAccessToken);

  const data = await fetchJson<{
    data?: Array<{
      id?: string;
      name?: string;
      access_token?: string;
      instagram_business_account?: { id?: string; username?: string };
      connected_instagram_account?: { id?: string; username?: string };
    }>;
  }>(url.toString(), {
    method: "GET",
    cache: "no-store",
  });

  const pages = Array.isArray(data.data) ? data.data : [];
  return pages
    .map((page) => {
      const pageId = page.id?.trim() ?? "";
      const pageName = page.name?.trim() ?? "";
      const pageAccessToken = page.access_token?.trim() ?? "";
      if (!pageId || !pageAccessToken) return null;

      const ig =
        page.instagram_business_account ?? page.connected_instagram_account;

      return {
        pageId,
        pageName: pageName || pageId,
        pageAccessToken,
        instagramBusinessAccountId: ig?.id?.trim() || null,
        instagramUsername: ig?.username?.trim() || null,
      } satisfies MetaManagedPage;
    })
    .filter((item): item is MetaManagedPage => item !== null);
}

export async function subscribeAppToPage(params: {
  pageId: string;
  pageAccessToken: string;
}): Promise<void> {
  const url = new URL(metaGraphUrl(`${params.pageId}/subscribed_apps`));
  url.searchParams.set("access_token", params.pageAccessToken);

  // Nao bloqueia o fluxo por falha aqui; melhor effort.
  try {
    await fetchJson(url.toString(), {
      method: "POST",
      cache: "no-store",
    });
  } catch (err) {
    console.warn("[meta-api] subscribeAppToPage falhou:", err);
  }
}

export async function sendMetaTextMessage(params: {
  channel: "messenger" | "instagram";
  businessId: string;
  recipientId: string;
  text: string;
  pageAccessToken: string;
}): Promise<void> {
  const url = new URL(metaGraphUrl(`${params.businessId}/messages`));
  url.searchParams.set("access_token", params.pageAccessToken);

  const body: Record<string, unknown> = {
    recipient: { id: params.recipientId },
    message: { text: params.text },
  };
  if (params.channel === "messenger") {
    body.messaging_type = "RESPONSE";
  }

  await fetchJson(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

