import { afterEach, describe, expect, it, vi } from "vitest";
import { requestClientSecret } from "./clientSecret";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("requestClientSecret", () => {
	it("posts the booking ID as JSON and returns the client secret", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: vi.fn().mockResolvedValue({ clientSecret: "cs_test_123" }),
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(requestClientSecret("booking_test_123")).resolves.toBe(
			"cs_test_123"
		);
		expect(fetchMock).toHaveBeenCalledWith("/api/payment", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ bookingId: "booking_test_123" }),
		});
	});

	it("rejects non-successful payment responses", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 403 })
		);

		await expect(requestClientSecret("booking_test_123")).rejects.toThrow(
			"Failed to initialize checkout (403)"
		);
	});

	it("rejects successful responses without a client secret", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue({}),
			})
		);

		await expect(requestClientSecret("booking_test_123")).rejects.toThrow(
			"Payment response did not include a client secret"
		);
	});
});
