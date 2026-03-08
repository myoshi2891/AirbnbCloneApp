import { describe, it, expect } from "vitest";
import {
	caluculateDaysBetween,
	generateBlockedPeriods,
	generateDateRange,
} from "../calender";

describe("caluculateDaysBetween", () => {
	it("2日間の差を正しく計算する", () => {
		const result = caluculateDaysBetween({
			checkIn: new Date("2024-01-01"),
			checkOut: new Date("2024-01-03"),
		});
		expect(result).toBe(2);
	});

	it("同日の場合は 0 を返す", () => {
		const result = caluculateDaysBetween({
			checkIn: new Date("2024-01-01"),
			checkOut: new Date("2024-01-01"),
		});
		expect(result).toBe(0);
	});
});

describe("generateBlockedPeriods", () => {
	it("予約と過去日を含むブロック期間を生成する", () => {
		const today = new Date("2024-06-15");
		const bookings = [
			{
				checkIn: new Date("2024-06-20"),
				checkOut: new Date("2024-06-25"),
			},
		];

		const result = generateBlockedPeriods({ bookings, today });

		// 予約期間 + 過去日のブロック（today の前日まで）
		expect(result).toHaveLength(2);
		expect(result[0].from).toEqual(new Date("2024-06-20"));
		expect(result[0].to).toEqual(new Date("2024-06-25"));
	});

	it("予約がない場合は過去日ブロックのみ返す", () => {
		const today = new Date("2024-06-15");
		const result = generateBlockedPeriods({ bookings: [], today });

		expect(result).toHaveLength(1);
	});
});

describe("generateDateRange", () => {
	it("日付範囲の文字列配列を生成する", () => {
		const result = generateDateRange({
			from: new Date("2024-01-01"),
			to: new Date("2024-01-03"),
		});

		expect(result).toEqual(["2024-01-01", "2024-01-02", "2024-01-03"]);
	});

	it("undefined の場合は空配列を返す", () => {
		expect(generateDateRange(undefined)).toEqual([]);
	});

	it("from のみの場合は空配列を返す", () => {
		expect(
			generateDateRange({ from: new Date("2024-01-01"), to: undefined })
		).toEqual([]);
	});
});
