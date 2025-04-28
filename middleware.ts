import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher(["/", "/properties(.*)"]);
const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

export default clerkMiddleware((auth, req) => {
	const isAdminUser = auth().userId === process.env.ADMIN_USER_ID;

	if (isAdminRoute(req) && !isAdminUser) {
		return NextResponse.redirect(new URL("/", req.url));
	}

	if (!isPublicRoute(req)) {
		const result = auth().protect(); // ★ protectを呼んで
		if (result instanceof NextResponse) {
			return result; // ★ NextResponseだったら返す
		}
		// ★ それ以外は何もしない (＝認証OKなので続行)
	}

	return NextResponse.next(); // ★ 忘れずに普通に次へ
});

export const config = {
	matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
