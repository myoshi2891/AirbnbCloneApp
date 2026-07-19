import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockCreateRouteMatcher } = vi.hoisted(() => ({
	mockCreateRouteMatcher: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
	clerkMiddleware: (handler: unknown) => handler,
	createRouteMatcher: (patterns: string[]) => {
		mockCreateRouteMatcher(patterns);
		return (req: NextRequest) => {
			const pathname = new URL(req.url).pathname;
			return patterns.some((pattern) => {
				if (pattern === "/") return pathname === "/";
				if (pattern.endsWith("(.*)")) {
					return pathname.startsWith(pattern.slice(0, -4));
				}
				return pathname === pattern;
			});
		};
	},
}));

import middleware from "./middleware";

type MiddlewareAuth = (() => Promise<{ userId: string | null }>) & {
	protect: ReturnType<typeof vi.fn>;
};

const invokeMiddleware = middleware as unknown as (
	auth: MiddlewareAuth,
	req: NextRequest
) => Promise<Response>;

function createAuth(userId: string | null) {
	const protect = vi.fn().mockResolvedValue(undefined);
	const auth = Object.assign(vi.fn().mockResolvedValue({ userId }), { protect });
	return { auth, protect };
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("middleware", () => {
	it("Stripe webhook は Clerk 認証を通さず、他の API は保護する", async () => {
		const webhookAuth = createAuth(null);
		await invokeMiddleware(
			webhookAuth.auth,
			new NextRequest("http://localhost:3000/api/webhook")
		);

		expect(webhookAuth.protect).not.toHaveBeenCalled();
		expect(mockCreateRouteMatcher).toHaveBeenCalledWith(
			expect.arrayContaining(["/api/webhook(.*)"])
		);

		const paymentAuth = createAuth(null);
		await invokeMiddleware(
			paymentAuth.auth,
			new NextRequest("http://localhost:3000/api/payment")
		);

		expect(paymentAuth.protect).toHaveBeenCalledOnce();
	});

	it("管理者ルートでは設定済み管理者だけを許可する", async () => {
		vi.stubEnv("ADMIN_USER_ID", "user_admin_test");
		const nonAdminAuth = createAuth("user_other");

		const redirectResponse = await invokeMiddleware(
			nonAdminAuth.auth,
			new NextRequest("http://localhost:3000/admin")
		);

		expect(redirectResponse.headers.get("location")).toBe("http://localhost:3000/");
		expect(nonAdminAuth.protect).not.toHaveBeenCalled();

		const adminAuth = createAuth("user_admin_test");
		await invokeMiddleware(
			adminAuth.auth,
			new NextRequest("http://localhost:3000/admin")
		);

		expect(adminAuth.protect).toHaveBeenCalledOnce();
	});
});
