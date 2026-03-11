import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCurrentOrganization } from "@/lib/auth-utils";
import { getMetaOAuthUrl } from "@/lib/meta-api";

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

  const redirectUri = `${appBaseUrl(request)}/api/meta/oauth/callback`;
  const state = crypto.randomUUID();
  const oauthUrl = getMetaOAuthUrl({ redirectUri, state });
  const response = NextResponse.redirect(oauthUrl);
  const maxAge = 10 * 60;

  response.cookies.set("meta_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  response.cookies.set("meta_oauth_org_id", org.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });

  return response;
}

