import { describe, it, expect } from "vitest";
import { calculateTotals } from "../calculateTotals";

describe("calculateTotals", () => {
	it("3泊・$100/泊 の合計を正しく計算する", () => {
		const result = calculateTotals({
			checkIn: new Date("2024-01-01"),
			checkOut: new Date("2024-01-04"),
			price: 100,
		});

		expect(result.totalNights).toBe(3);
		expect(result.subTotal).toBe(300);
		expect(result.cleaning).toBe(2);
		expect(result.service).toBe(4);
		expect(result.tax).toBe(30); // 300 * 0.1
		expect(result.orderTotal).toBe(336); // 300 + 2 + 4 + 30
	});

	it("同日チェックイン/アウトでは 0 泊になる", () => {
		const result = calculateTotals({
			checkIn: new Date("2024-01-01"),
			checkOut: new Date("2024-01-01"),
			price: 100,
		});

		expect(result.totalNights).toBe(0);
		expect(result.subTotal).toBe(0);
		expect(result.orderTotal).toBe(6); // 0 + 2 + 4 + 0
	});

	it("1泊・$50/泊 の合計を正しく計算する", () => {
		const result = calculateTotals({
			checkIn: new Date("2024-06-01"),
			checkOut: new Date("2024-06-02"),
			price: 50,
		});

		expect(result.totalNights).toBe(1);
		expect(result.subTotal).toBe(50);
		expect(result.tax).toBe(5); // 50 * 0.1
		expect(result.orderTotal).toBe(61); // 50 + 2 + 4 + 5
	});
});
