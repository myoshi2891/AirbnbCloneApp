import { describe, it, expect, vi, beforeEach } from "vitest";

// Stripe モック（vi.hoisted でホイスト対応）
const { mockCreate } = vi.hoisted(() => ({
	mockCreate: vi.fn(),
}));
vi.mock("stripe", () => ({
	default: class StripeMock {
		checkout = { sessions: { create: mockCreate } };
	},
}));

// Prisma モック
vi.mock("@/utils/db", () => ({
	default: {
		booking: {
			findUnique: vi.fn(),
		},
	},
}));

// formatDate モック
vi.mock("@/utils/format", () => ({
	formatDate: vi.fn(() => "January 1, 2024"),
}));

import db from "@/utils/db";
import { POST } from "../payment/route";
import { NextRequest } from "next/server";

describe("POST /api/payment", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("正常なリクエストで clientSecret を返す", async () => {
		const mockBooking = {
			id: "booking-1",
			totalNights: 3,
			orderTotal: 300,
			checkIn: new Date("2024-01-01"),
			checkOut: new Date("2024-01-04"),
			property: { name: "Beach House", image: "https://example.com/img.jpg" },
		};

		vi.mocked(db.booking.findUnique).mockResolvedValue(mockBooking as never);
		mockCreate.mockResolvedValue({ client_secret: "cs_test_123" });

		const req = new NextRequest("http://localhost:3000/api/payment", {
			method: "POST",
			body: JSON.stringify({ bookingId: "booking-1" }),
			headers: { origin: "http://localhost:3000" },
		});

		const response = await POST(req, {} as never);
		const data = await response.json();

		expect(data.clientSecret).toBe("cs_test_123");
		expect(db.booking.findUnique).toHaveBeenCalledWith({
			where: { id: "booking-1" },
			include: { property: { select: { name: true, image: true } } },
		});
	});

	it("予約が見つからない場合は 404 を返す", async () => {
		vi.mocked(db.booking.findUnique).mockResolvedValue(null);

		const req = new NextRequest("http://localhost:3000/api/payment", {
			method: "POST",
			body: JSON.stringify({ bookingId: "nonexistent" }),
			headers: { origin: "http://localhost:3000" },
		});

		const response = await POST(req, {} as never);
		expect(response.status).toBe(404);
	});
});
