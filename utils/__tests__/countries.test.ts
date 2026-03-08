import { describe, it, expect } from "vitest";
import { findCountryByCode, formattedCountries } from "../countries";

describe("formattedCountries", () => {
	it("国の配列を返す", () => {
		expect(formattedCountries.length).toBeGreaterThan(0);
	});

	it("各国が必要なプロパティを持つ", () => {
		const country = formattedCountries[0];
		expect(country).toHaveProperty("code");
		expect(country).toHaveProperty("name");
		expect(country).toHaveProperty("flag");
		expect(country).toHaveProperty("location");
		expect(country).toHaveProperty("region");
	});
});

describe("findCountryByCode", () => {
	it("既知のコードで国を返す", () => {
		const japan = findCountryByCode("JP");
		expect(japan).toBeDefined();
		expect(japan?.name).toBe("Japan");
	});

	it("US コードで United States を返す", () => {
		const us = findCountryByCode("US");
		expect(us).toBeDefined();
		expect(us?.name).toBe("United States");
	});

	it("不明なコードで undefined を返す", () => {
		expect(findCountryByCode("XX")).toBeUndefined();
	});
});
