import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted でホイスト対応
const { mockRedirect, mockRetrieve } = vi.hoisted(() => ({
	mockRedirect: vi.fn(),
	mockRetrieve: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	redirect: (...args: unknown[]) => {
		mockRedirect(...args);
		throw new Error("NEXT_REDIRECT");
	},
}));

vi.mock("stripe", () => ({
	default: class StripeMock {
		checkout = { sessions: { retrieve: mockRetrieve } };
	},
}));

// Prisma モック
vi.mock("@/utils/db", () => ({
	default: {
		booking: {
			update: vi.fn(),
		},
	},
}));

import db from "@/utils/db";
import { GET } from "../confirm/route";
import { NextRequest } from "next/server";

describe("GET /api/confirm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("正常な session で booking を更新し redirect する", async () => {
		mockRetrieve.mockResolvedValue({
			status: "complete",
			metadata: { bookingId: "booking-1" },
		});

		vi.mocked(db.booking.update).mockResolvedValue({} as never);

		const req = new NextRequest(
			"http://localhost:3000/api/confirm?session_id=sess_123"
		);

		// redirect は Error をスローするので catch する
		await expect(GET(req)).rejects.toThrow("NEXT_REDIRECT");

		expect(db.booking.update).toHaveBeenCalledWith({
			where: { id: "booking-1" },
			data: { paymentStatus: true },
		});
		expect(mockRedirect).toHaveBeenCalledWith("/bookings");
	});

	it("session が complete でない場合は 500 を返す", async () => {
		mockRetrieve.mockResolvedValue({
			status: "open",
			metadata: { bookingId: "booking-1" },
		});

		const req = new NextRequest(
			"http://localhost:3000/api/confirm?session_id=sess_456"
		);

		const response = await GET(req);
		expect(response.status).toBe(500);
	});
});
