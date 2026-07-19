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
			updateMany: vi.fn(),
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

	it("complete かつ paid の session だけ booking を更新し redirect する", async () => {
		mockRetrieve.mockResolvedValue({
			status: "complete",
			payment_status: "paid",
			metadata: { bookingId: "booking-1" },
		});

		vi.mocked(db.booking.updateMany).mockResolvedValue({ count: 1 } as never);

		const req = new NextRequest(
			"http://localhost:3000/api/confirm?session_id=sess_123"
		);

		// redirect は Error をスローするので catch する
		await expect(GET(req)).rejects.toThrow("NEXT_REDIRECT");

		expect(db.booking.updateMany).toHaveBeenCalledWith({
			where: { id: "booking-1", paymentStatus: false },
			data: { paymentStatus: true },
		});
		expect(mockRedirect).toHaveBeenCalledWith("/bookings");
	});

	it("complete でも unpaid の session は確定せず pending 画面へ redirect する", async () => {
		mockRetrieve.mockResolvedValue({
			status: "complete",
			payment_status: "unpaid",
			metadata: { bookingId: "booking-1" },
		});

		const req = new NextRequest(
			"http://localhost:3000/api/confirm?session_id=sess_pending"
		);

		await expect(GET(req)).rejects.toThrow("NEXT_REDIRECT");

		expect(db.booking.updateMany).not.toHaveBeenCalled();
		expect(mockRedirect).toHaveBeenCalledWith(
			"/checkout/pending?session_id=sess_pending"
		);
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
