import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import {
  exchangeCodeForUserToken,
  fetchManagedPages,
  subscribeAppToPage,
} from "@/lib/meta-api";
import {
  mergeMetaChannels,
  parseMetaChannelsSettings,
  type MetaChannelConnection,
} from "@/lib/meta-channel-settings";
import { ensureMetaSessionsForPage } from "@/lib/meta-channel-sessions";
import { eq } from "drizzle-orm";

function appBaseUrl(request: NextRequest): string {
  const envBase = process.env.NEXTAUTH_URL?.trim();
  if (envBase) return envBase.replace(/\/$/, "");
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const org = await getCurrentOrganization();
  if (!org) {
    return NextResponse.redirect(new URL("/dashboard/whatsapp?meta=org_missing", request.url));
  }

  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code")?.trim() ?? "";
  const state = searchParams.get("state")?.trim() ?? "";
  const oauthError = searchParams.get("error")?.trim();
  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/dashboard/whatsapp?meta=oauth_error&reason=${encodeURIComponent(oauthError)}`, request.url)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/dashboard/whatsapp?meta=missing_code", request.url));
  }

  const cookieState = request.cookies.get("meta_oauth_state")?.value ?? "";
  const cookieOrgId = request.cookies.get("meta_oauth_org_id")?.value ?? "";
  if (!cookieState || cookieState !== state || cookieOrgId !== org.id) {
    return NextResponse.redirect(new URL("/dashboard/whatsapp?meta=invalid_state", request.url));
  }

  try {
    const redirectUri = `${appBaseUrl(request)}/api/meta/oauth/callback`;
    const userAccessToken = await exchangeCodeForUserToken({
      code,
      redirectUri,
    });
    const pages = await fetchManagedPages(userAccessToken);
    if (pages.length === 0) {
      return NextResponse.redirect(new URL("/dashboard/whatsapp?meta=no_pages", request.url));
    }

    const nowIso = new Date().toISOString();
    const incomingChannels: MetaChannelConnection[] = pages.map((page) => ({
      pageId: page.pageId,
      pageName: page.pageName,
      pageAccessToken: page.pageAccessToken,
      instagramBusinessAccountId: page.instagramBusinessAccountId,
      instagramUsername: page.instagramUsername,
      connectedAt: nowIso,
      updatedAt: nowIso,
    }));

    const currentSettings = (org.settings as Record<string, unknown> | undefined) ?? {};
    const currentMeta = parseMetaChannelsSettings(currentSettings.metaChannels);
    const merged = mergeMetaChannels(currentMeta, incomingChannels);

    await db
      .update(organizations)
      .set({
        settings: {
          ...currentSettings,
          metaChannels: merged,
        },
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, org.id));

    for (const page of pages) {
      await ensureMetaSessionsForPage({
        organizationId: org.id,
        pageId: page.pageId,
        pageName: page.pageName,
        instagramBusinessAccountId: page.instagramBusinessAccountId,
        instagramUsername: page.instagramUsername,
      });

      await subscribeAppToPage({
        pageId: page.pageId,
        pageAccessToken: page.pageAccessToken,
      });
    }

    const response = NextResponse.redirect(new URL("/dashboard/whatsapp?meta=connected", request.url));
    response.cookies.delete("meta_oauth_state");
    response.cookies.delete("meta_oauth_org_id");
    return response;
  } catch (err) {
    console.error("[meta oauth callback]", err);
    const response = NextResponse.redirect(
      new URL("/dashboard/whatsapp?meta=callback_error", request.url)
    );
    response.cookies.delete("meta_oauth_state");
    response.cookies.delete("meta_oauth_org_id");
    return response;
  }
}

