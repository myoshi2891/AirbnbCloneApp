import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockConstructEvent } = vi.hoisted(() => ({
	mockConstructEvent: vi.fn(),
}));

vi.mock("stripe", () => ({
	default: class StripeMock {
		webhooks = { constructEvent: mockConstructEvent };
	},
}));

vi.mock("@/utils/db", () => ({
	default: {
		booking: {
			updateMany: vi.fn(),
		},
	},
}));

import db from "@/utils/db";
import { POST } from "../webhook/route";
import { NextRequest } from "next/server";

const createRequest = (signature?: string) =>
	new NextRequest("http://localhost:3000/api/webhook", {
		method: "POST",
		body: '{"event":"payload"}',
		headers: signature ? { "stripe-signature": signature } : undefined,
	});

const paidSessionEvent = (type: string, paymentStatus = "paid") => ({
	type,
	data: {
		object: {
			payment_status: paymentStatus,
			metadata: { bookingId: "booking-1" },
		},
	},
});

describe("POST /api/webhook", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_dummy");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("署名がない場合は 400 を返し booking を更新しない", async () => {
		const response = await POST(createRequest());

		expect(response.status).toBe(400);
		expect(mockConstructEvent).not.toHaveBeenCalled();
		expect(db.booking.updateMany).not.toHaveBeenCalled();
	});

	it("不正な署名の場合は 400 を返し booking を更新しない", async () => {
		mockConstructEvent.mockImplementation(() => {
			throw new Error("Invalid signature");
		});

		const response = await POST(createRequest("invalid-signature"));

		expect(response.status).toBe(400);
		expect(db.booking.updateMany).not.toHaveBeenCalled();
	});

	it.each([
		"checkout.session.completed",
		"checkout.session.async_payment_succeeded",
	])("paid の %s で booking を冪等に確定する", async (type) => {
		mockConstructEvent.mockReturnValue(paidSessionEvent(type));
		vi.mocked(db.booking.updateMany).mockResolvedValue({ count: 1 } as never);

		const response = await POST(createRequest("valid-signature"));

		expect(response.status).toBe(200);
		expect(mockConstructEvent).toHaveBeenCalledWith(
			'{"event":"payload"}',
			"valid-signature",
			"whsec_test_dummy"
		);
		expect(db.booking.updateMany).toHaveBeenCalledWith({
			where: { id: "booking-1", paymentStatus: false },
			data: { paymentStatus: true },
		});
	});

	it.each([
		paidSessionEvent("checkout.session.completed", "unpaid"),
		paidSessionEvent("checkout.session.async_payment_succeeded", "unpaid"),
		paidSessionEvent("checkout.session.async_payment_failed"),
		paidSessionEvent("payment_intent.succeeded"),
	])("確定対象外イベントは booking を更新せず 200 を返す", async (event) => {
		mockConstructEvent.mockReturnValue(event);

		const response = await POST(createRequest("valid-signature"));

		expect(response.status).toBe(200);
		expect(db.booking.updateMany).not.toHaveBeenCalled();
	});
});
