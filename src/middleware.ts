import { auth } from "@/auth";

export default auth((req) => {
  const pathname = req.nextUrl.pathname;
  const isLoggedIn = !!req.auth;
  const isAuthPage =
    pathname.startsWith("/login") ||
    pathname.startsWith("/registro");
  const isPublicPage = pathname === "/";
  const isPublicAsset = /\.[^/]+$/.test(pathname); // /logo.png, /icon_mendoza.png, etc.

  if (isPublicAsset) {
    return;
  }

  if (isAuthPage || isPublicPage) {
    if (isLoggedIn && (isAuthPage || isPublicPage)) {
      return Response.redirect(new URL("/dashboard", req.url));
    }
    return;
  }

  if (!isLoggedIn) {
    return Response.redirect(new URL("/login", req.url));
  }

  return;
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
