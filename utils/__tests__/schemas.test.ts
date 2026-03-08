import { describe, it, expect } from "vitest";
import {
	profileSchema,
	propertySchema,
	createReviewSchema,
	validateWithZodSchema,
} from "../schemas";

describe("validateWithZodSchema", () => {
	it("有効なデータを返す", () => {
		const data = { firstName: "John", lastName: "Doe", username: "johndoe" };
		const result = validateWithZodSchema(profileSchema, data);
		expect(result).toEqual(data);
	});

	it("無効なデータでエラーをスローする", () => {
		const data = { firstName: "J", lastName: "D", username: "j" };
		expect(() => validateWithZodSchema(profileSchema, data)).toThrow();
	});
});

describe("profileSchema", () => {
	it("2文字以上の名前を受け付ける", () => {
		const result = profileSchema.safeParse({
			firstName: "Ab",
			lastName: "Cd",
			username: "ab",
		});
		expect(result.success).toBe(true);
	});

	it("1文字の名前を拒否する", () => {
		const result = profileSchema.safeParse({
			firstName: "A",
			lastName: "B",
			username: "a",
		});
		expect(result.success).toBe(false);
	});
});

describe("propertySchema", () => {
	const validProperty = {
		name: "Beach House",
		tagline: "Beautiful beach house",
		price: 100,
		category: "cabin",
		description:
			"A wonderful place to stay with beautiful views of the ocean and surrounding nature",
		country: "US",
		guests: 4,
		bedrooms: 2,
		beds: 3,
		baths: 1,
		amenities: "[]",
	};

	it("有効なプロパティデータを受け付ける", () => {
		const result = propertySchema.safeParse(validProperty);
		expect(result.success).toBe(true);
	});

	it("description が 10 単語未満の場合に拒否する", () => {
		const result = propertySchema.safeParse({
			...validProperty,
			description: "Too short",
		});
		expect(result.success).toBe(false);
	});

	it("負の price を拒否する", () => {
		const result = propertySchema.safeParse({
			...validProperty,
			price: -1,
		});
		expect(result.success).toBe(false);
	});
});

describe("createReviewSchema", () => {
	it("有効なレビューデータを受け付ける", () => {
		const result = createReviewSchema.safeParse({
			propertyId: "abc123",
			rating: 5,
			comment: "Great place to stay, highly recommended!",
		});
		expect(result.success).toBe(true);
	});

	it("rating が 1-5 の範囲外の場合に拒否する", () => {
		const result = createReviewSchema.safeParse({
			propertyId: "abc123",
			rating: 6,
			comment: "Great place to stay!",
		});
		expect(result.success).toBe(false);
	});

	it("comment が 10 文字未満の場合に拒否する", () => {
		const result = createReviewSchema.safeParse({
			propertyId: "abc123",
			rating: 4,
			comment: "Good",
		});
		expect(result.success).toBe(false);
	});
});
