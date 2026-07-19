import { describe, it, expect, vi, beforeEach } from "vitest";

// Stripe モック（vi.hoisted でホイスト対応）
const { mockCreate, mockRetrieve } = vi.hoisted(() => ({
	mockCreate: vi.fn(),
	mockRetrieve: vi.fn(),
}));
vi.mock("stripe", () => ({
	default: class StripeMock {
		checkout = { sessions: { create: mockCreate, retrieve: mockRetrieve } };
	},
}));

const { mockAuth } = vi.hoisted(() => ({
	mockAuth: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({
	auth: mockAuth,
}));

// Prisma モック
vi.mock("@/utils/db", () => ({
	default: {
		booking: {
			findFirst: vi.fn(),
			update: vi.fn(),
		},
	},
}));

// formatDate モック
const { mockFormatDate } = vi.hoisted(() => ({
	mockFormatDate: vi.fn(() => "January 1, 2024"),
}));
vi.mock("@/utils/format", () => ({
	formatDate: mockFormatDate,
}));

import db from "@/utils/db";
import { POST } from "../payment/route";
import { NextRequest } from "next/server";

const BOOKING_ID = "550e8400-e29b-41d4-a716-446655440000";
const MISSING_BOOKING_ID = "550e8400-e29b-41d4-a716-446655440001";
const OTHER_USER_BOOKING_ID = "550e8400-e29b-41d4-a716-446655440002";

describe("POST /api/payment", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuth.mockResolvedValue({ userId: "user-1" });
		process.env.NEXT_PUBLIC_WEBSITE_URL = "https://app.example.com";
		mockCreate.mockResolvedValue({
			id: "cs_test_123",
			client_secret: "cs_test_123",
			expires_at: 1_800_000_000,
		});
	});

	it("正常なリクエストで clientSecret を返す", async () => {
		const mockBooking = {
			id: BOOKING_ID,
			totalNights: 3,
			orderTotal: 300,
			checkIn: new Date("2024-01-01"),
			checkOut: new Date("2024-01-04"),
			property: { name: "Beach House", image: "https://example.com/img.jpg" },
		};

		vi.mocked(db.booking.findFirst).mockResolvedValue(mockBooking as never);
		const req = new NextRequest("http://localhost:3000/api/payment", {
			method: "POST",
			body: JSON.stringify({ bookingId: BOOKING_ID }),
			headers: { origin: "https://attacker.example" },
		});

		const response = await POST(req);
		const data = await response.json();

		expect(data.clientSecret).toBe("cs_test_123");
		expect(db.booking.findFirst).toHaveBeenCalledWith({
			where: { id: BOOKING_ID, profileId: "user-1" },
			include: { property: { select: { name: true, image: true } } },
		});
		expect(db.booking.update).toHaveBeenCalledWith({
			where: { id: BOOKING_ID },
			data: {
				checkoutSessionId: "cs_test_123",
				checkoutSessionExpiresAt: new Date(1_800_000_000 * 1000),
			},
		});
		expect(mockCreate).toHaveBeenCalledWith(expect.any(Object), {
			idempotencyKey: `checkout-session-${BOOKING_ID}-initial`,
		});
	});

	it("Embedded Checkout 用の return_url を設定する", async () => {
		const mockBooking = {
			id: BOOKING_ID,
			totalNights: 3,
			orderTotal: 300,
			checkIn: new Date("2024-01-01"),
			checkOut: new Date("2024-01-04"),
			property: { name: "Beach House", image: "https://example.com/img.jpg" },
		};

		vi.mocked(db.booking.findFirst).mockResolvedValue(mockBooking as never);
		const req = new NextRequest("http://localhost:3000/api/payment", {
			method: "POST",
			body: JSON.stringify({ bookingId: BOOKING_ID }),
			headers: { origin: "http://localhost:3000" },
		});

		await POST(req);

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				ui_mode: "embedded",
				return_url:
					"https://app.example.com/api/confirm?session_id={CHECKOUT_SESSION_ID}",
			}),
			{ idempotencyKey: `checkout-session-${BOOKING_ID}-initial` }
		);
		expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("success_url");
	});

	it("Stripe session の description に checkIn 日付を使用する", async () => {
		const checkInDate = new Date("2024-01-01");
		const checkOutDate = new Date("2024-01-04");
		const mockBooking = {
			id: BOOKING_ID,
			totalNights: 3,
			orderTotal: 300,
			checkIn: checkInDate,
			checkOut: checkOutDate,
			property: { name: "Beach House", image: "https://example.com/img.jpg" },
		};

		vi.mocked(db.booking.findFirst).mockResolvedValue(mockBooking as never);
		const req = new NextRequest("http://localhost:3000/api/payment", {
			method: "POST",
			body: JSON.stringify({ bookingId: BOOKING_ID }),
			headers: { origin: "http://localhost:3000" },
		});

		await POST(req);

		// formatDate は checkIn（滞在開始日）で1回だけ呼ばれるべき
		expect(mockFormatDate).toHaveBeenCalledTimes(1);
		expect(mockFormatDate).toHaveBeenCalledWith(checkInDate);

		// Stripe session create に渡された description を検証
		expect(mockCreate).toHaveBeenCalledTimes(1);
		const createArg = mockCreate.mock.calls[0][0];
		const description =
			createArg.line_items[0].price_data.product_data.description;
		expect(description).toBe(
			"Stay in this wonderful place for 3 nights, from January 1, 2024. Enjoy your stay!"
		);
	});

	it("有効な保存済み Session を再利用する", async () => {
		const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
		vi.mocked(db.booking.findFirst).mockResolvedValue({
			id: BOOKING_ID,
			paymentStatus: false,
			checkoutSessionId: "cs_existing",
			checkoutSessionExpiresAt: expiresAt,
			property: { name: "Beach House", image: "https://example.com/img.jpg" },
		} as never);
		mockRetrieve.mockResolvedValue({
			status: "open",
			client_secret: "cs_existing_secret",
		});

		const response = await POST(paymentRequest());

		expect(await response.json()).toEqual({ clientSecret: "cs_existing_secret" });
		expect(mockRetrieve).toHaveBeenCalledWith("cs_existing");
		expect(mockCreate).not.toHaveBeenCalled();
		expect(db.booking.update).not.toHaveBeenCalled();
	});

	it("期限切れの Session には新しい Session を作成して追跡情報を更新する", async () => {
		const expiredAt = new Date("2025-01-01T00:00:00.000Z");
		vi.mocked(db.booking.findFirst).mockResolvedValue({
			id: BOOKING_ID,
			paymentStatus: false,
			checkoutSessionId: "cs_expired",
			checkoutSessionExpiresAt: expiredAt,
			totalNights: 3,
			orderTotal: 300,
			checkIn: new Date("2025-02-01"),
			checkOut: new Date("2025-02-04"),
			property: { name: "Beach House", image: "https://example.com/img.jpg" },
		} as never);

		const response = await POST(paymentRequest());

		expect(response.status).toBe(200);
		expect(mockRetrieve).not.toHaveBeenCalled();
		expect(mockCreate).toHaveBeenCalledWith(expect.any(Object), {
			idempotencyKey: `checkout-session-${BOOKING_ID}-${expiredAt.getTime()}`,
		});
		expect(db.booking.update).toHaveBeenCalledWith({
			where: { id: BOOKING_ID },
			data: {
				checkoutSessionId: "cs_test_123",
				checkoutSessionExpiresAt: new Date(1_800_000_000 * 1000),
			},
		});
	});

	it("未完了の有効 Session には新しい Session を作成しない", async () => {
		vi.mocked(db.booking.findFirst).mockResolvedValue({
			id: BOOKING_ID,
			paymentStatus: false,
			checkoutSessionId: "cs_completed",
			checkoutSessionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
			property: { name: "Beach House", image: "https://example.com/img.jpg" },
		} as never);
		mockRetrieve.mockResolvedValue({ status: "complete" });

		const response = await POST(paymentRequest());

		expect(response.status).toBe(409);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("予約が見つからない場合は 404 を返す", async () => {
		vi.mocked(db.booking.findFirst).mockResolvedValue(null);

		const req = new NextRequest("http://localhost:3000/api/payment", {
			method: "POST",
			body: JSON.stringify({ bookingId: MISSING_BOOKING_ID }),
			headers: { origin: "http://localhost:3000" },
		});

		const response = await POST(req);
		expect(response.status).toBe(404);
	});

	it("支払い済み予約には Checkout セッションを作成しない", async () => {
		vi.mocked(db.booking.findFirst).mockResolvedValue({
			id: BOOKING_ID,
			paymentStatus: true,
		} as never);

		const req = new NextRequest("http://localhost:3000/api/payment", {
			method: "POST",
			body: JSON.stringify({ bookingId: BOOKING_ID }),
		});

		const response = await POST(req);

		expect(response.status).toBe(404);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("未認証の場合は 401 を返す", async () => {
		// Arrange
		mockAuth.mockResolvedValue({ userId: null });
		const req = new NextRequest("http://localhost:3000/api/payment", {
			method: "POST",
			body: JSON.stringify({ bookingId: BOOKING_ID }),
		});

		// Act
		const response = await POST(req);

		// Assert
		expect(response.status).toBe(401);
		expect(db.booking.findFirst).not.toHaveBeenCalled();
	});

	it("他人の予約の場合は 404 を返す", async () => {
		// Arrange
		vi.mocked(db.booking.findFirst).mockResolvedValue(null);
		const req = new NextRequest("http://localhost:3000/api/payment", {
			method: "POST",
			body: JSON.stringify({ bookingId: OTHER_USER_BOOKING_ID }),
			headers: { origin: "http://localhost:3000" },
		});

		// Act
		const response = await POST(req);

		// Assert
		expect(response.status).toBe(404);
		expect(db.booking.findFirst).toHaveBeenCalledWith({
			where: { id: OTHER_USER_BOOKING_ID, profileId: "user-1" },
			include: { property: { select: { name: true, image: true } } },
		});
	});

	it("不正な JSON には 400 を返し予約を検索しない", async () => {
		const req = new NextRequest("http://localhost:3000/api/payment", {
			method: "POST",
			body: "{",
		});

		const response = await POST(req);

		expect(response.status).toBe(400);
		expect(db.booking.findFirst).not.toHaveBeenCalled();
	});

	it("bookingId がない場合は 400 を返し予約を検索しない", async () => {
		const req = new NextRequest("http://localhost:3000/api/payment", {
			method: "POST",
			body: JSON.stringify({}),
		});

		const response = await POST(req);

		expect(response.status).toBe(400);
		expect(db.booking.findFirst).not.toHaveBeenCalled();
	});

	it("bookingId が UUID でない場合は 400 を返し予約を検索しない", async () => {
		const req = new NextRequest("http://localhost:3000/api/payment", {
			method: "POST",
			body: JSON.stringify({ bookingId: "booking-1" }),
		});

		const response = await POST(req);

		expect(response.status).toBe(400);
		expect(db.booking.findFirst).not.toHaveBeenCalled();
	});
});

function paymentRequest() {
	return new NextRequest("http://localhost:3000/api/payment", {
		method: "POST",
		body: JSON.stringify({ bookingId: BOOKING_ID }),
	});
}
