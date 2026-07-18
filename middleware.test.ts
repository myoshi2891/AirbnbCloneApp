import { describe, expect, it, vi } from "vitest";
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

const invokeMiddleware = middleware as unknown as (
	auth: () => Promise<{ userId: string | null; protect: () => void }>,
	req: NextRequest
) => Promise<Response>;

describe("middleware", () => {
	it("Stripe webhook は Clerk 認証を通さず、他の API は保護する", async () => {
		const webhookProtect = vi.fn();
		await invokeMiddleware(
			async () => ({ userId: null, protect: webhookProtect }),
			new NextRequest("http://localhost:3000/api/webhook")
		);

		expect(webhookProtect).not.toHaveBeenCalled();
		expect(mockCreateRouteMatcher).toHaveBeenCalledWith(
			expect.arrayContaining(["/api/webhook(.*)"])
		);

		const paymentProtect = vi.fn();
		await invokeMiddleware(
			async () => ({ userId: null, protect: paymentProtect }),
			new NextRequest("http://localhost:3000/api/payment")
		);

		expect(paymentProtect).toHaveBeenCalledOnce();
	});
});
