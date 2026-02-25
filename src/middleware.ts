import { auth } from "@/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isAuthPage =
    req.nextUrl.pathname.startsWith("/login") ||
    req.nextUrl.pathname.startsWith("/registro");
  const isPublicPage = req.nextUrl.pathname === "/";

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
