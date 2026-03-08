import { describe, it, expect } from "vitest";
import { formatCurrency, formatQuantity, formatDate } from "../format";

describe("formatCurrency", () => {
	it("正の整数を USD フォーマットで返す", () => {
		expect(formatCurrency(100)).toBe("$100");
	});

	it("大きな数値にカンマ区切りを付ける", () => {
		expect(formatCurrency(1500)).toBe("$1,500");
	});

	it("null の場合は $0 を返す", () => {
		expect(formatCurrency(null)).toBe("$0");
	});

	it("0 の場合は $0 を返す", () => {
		expect(formatCurrency(0)).toBe("$0");
	});
});

describe("formatQuantity", () => {
	it("1 の場合は単数形を返す", () => {
		expect(formatQuantity(1, "night")).toBe("1 night");
	});

	it("2 以上の場合は複数形（末尾 s）を返す", () => {
		expect(formatQuantity(3, "night")).toBe("3 nights");
	});

	it("0 の場合は複数形を返す", () => {
		expect(formatQuantity(0, "guest")).toBe("0 guests");
	});
});

describe("formatDate", () => {
	it("日付を月・日・年のフォーマットで返す", () => {
		const date = new Date(2024, 0, 15); // January 15, 2024
		expect(formatDate(date)).toBe("January 15, 2024");
	});

	it("onlyMonth=true の場合は月・年のみ返す", () => {
		const date = new Date(2024, 5, 1); // June 1, 2024
		expect(formatDate(date, true)).toBe("June 2024");
	});
});
