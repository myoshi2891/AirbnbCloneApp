import { describe, it, expect, vi } from "vitest";
import {
	profileSchema,
	propertySchema,
	createBookingSchema,
	createReviewSchema,
	ValidationError,
	validateImageContent,
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
		expect(() => validateWithZodSchema(profileSchema, data)).toThrow(
			ValidationError
		);
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

describe("createBookingSchema", () => {
	it("有効な予約入力を受け付ける", () => {
		// Arrange
		const booking = {
			propertyId: "550e8400-e29b-41d4-a716-446655440000",
			checkIn: new Date("2030-06-20"),
			checkOut: new Date("2030-06-25"),
		};

		// Act
		const result = createBookingSchema.safeParse(booking);

		// Assert
		expect(result.success).toBe(true);
	});

	it("checkOut が checkIn より前の予約入力を拒否する", () => {
		// Arrange
		const booking = {
			propertyId: "550e8400-e29b-41d4-a716-446655440000",
			checkIn: new Date("2030-06-25"),
			checkOut: new Date("2030-06-20"),
		};

		// Act
		const result = createBookingSchema.safeParse(booking);

		// Assert
		expect(result.success).toBe(false);
	});

	it("事業タイムゾーンで過去の checkIn を拒否する", () => {
		const yesterday = getBusinessDateOffset(-1);
		const result = createBookingSchema.safeParse({
			propertyId: "550e8400-e29b-41d4-a716-446655440000",
			checkIn: yesterday,
			checkOut: getBusinessDateOffset(1),
		});

		expect(result.success).toBe(false);
	});

	it("事業タイムゾーンで当日の checkIn を受け付ける", () => {
		const today = getBusinessDateOffset(0);
		const result = createBookingSchema.safeParse({
			propertyId: "550e8400-e29b-41d4-a716-446655440000",
			checkIn: today,
			checkOut: getBusinessDateOffset(1),
		});

		expect(result.success).toBe(true);
	});
});

describe("validateImageContent", () => {
	it("declared MIME type と一致する PNG コンテンツを受け付ける", async () => {
		const file = new File(
			[new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
			"image.png",
			{ type: "image/png" }
		);

		await expect(validateImageContent(file)).resolves.toBeUndefined();
	});

	it("偽装された MIME type の画像コンテンツを拒否する", async () => {
		const file = new File(
			[new Uint8Array([0xff, 0xd8, 0xff])],
			"image.png",
			{ type: "image/png" }
		);

		const error = await validateImageContent(file).catch((reason) => reason);

		expect(error).toBeInstanceOf(ValidationError);
		expect(error.message).toBe(
			"File content does not match the declared image type"
		);
	});

	it("先頭 12 バイトだけを読み込む", async () => {
		const header = new Uint8Array([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		]);
		const slicedArrayBuffer = vi.fn(async () => header.buffer);
		const slice = vi.fn(() => ({ arrayBuffer: slicedArrayBuffer }));
		const fileArrayBuffer = vi.fn(() => {
			throw new Error("The full file must not be read");
		});
		const file = {
			type: "image/png",
			slice,
			arrayBuffer: fileArrayBuffer,
		} as unknown as File;

		await expect(validateImageContent(file)).resolves.toBeUndefined();

		expect(slice).toHaveBeenCalledWith(0, 12);
		expect(fileArrayBuffer).not.toHaveBeenCalled();
	});
});

function getBusinessDateOffset(offset: number) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Tokyo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date());
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((item) => item.type === type)?.value);

	return new Date(
		Date.UTC(part("year"), part("month") - 1, part("day") + offset)
	);
}
