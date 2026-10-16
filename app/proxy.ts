import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Shared-password gate for links handed to teammates (scripts/share.sh sets
// SITE_PASSWORD). Without it the app is open, as in local development.
// Covers pages and API routes alike, so chat cannot spend the model credit
// and /api/act cannot sign anything without the password.
export function proxy(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (same(given, password)) return NextResponse.next();
  }
  return new NextResponse("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Baonau pilot", charset="UTF-8"' },
  });
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
