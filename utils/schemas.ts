import * as z from "zod";
import { ZodSchema } from "zod";

export class ValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ValidationError";
	}
}

export const profileSchema = z.object({
	// firstName: z.string().max(5, { message: "Max length is 5 characters" }),
	firstName: z
		.string()
		.min(2, { message: "first name must be at least 2 characters" }),
	lastName: z
		.string()
		.min(2, { message: "last name must be at least 2 characters" }),
	username: z
		.string()
		.min(2, { message: "user name must be at least 2 characters" }),
});


/**
 * Validates data against a Zod schema.
 *
 * @param schema - The schema used to validate the data
 * @param data - The value to validate
 * @returns The validated data
 */
export function validateWithZodSchema<T>(
	schema: ZodSchema<T>,
	data: unknown
): T {
	const result = schema.safeParse(data);

	if (!result.success) {
		const errors = result.error.issues.map((issue) => issue.message);
		throw new ValidationError(errors.join(","));
	}

	return result.data;
}

export const imageSchema = z.object({
	image: validateFile(),
});

const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Verifies that an image file's content matches its declared MIME type.
 *
 * @param file - The image file to validate.
 * @throws ValidationError If the detected image type differs from the declared MIME type.
 */
export async function validateImageContent(file: File): Promise<void> {
	const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
	const imageType =
		bytes.length >= 3 &&
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff
			? "image/jpeg"
			: bytes.length >= 8 &&
				bytes[0] === 0x89 &&
				bytes[1] === 0x50 &&
				bytes[2] === 0x4e &&
				bytes[3] === 0x47 &&
				bytes[4] === 0x0d &&
				bytes[5] === 0x0a &&
				bytes[6] === 0x1a &&
				bytes[7] === 0x0a
				? "image/png"
				: (bytes.length >= 6 &&
						(String.fromCharCode(...bytes.slice(0, 6)) === "GIF87a" ||
							String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a"))
					? "image/gif"
					: bytes.length >= 12 &&
							String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
							String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
						? "image/webp"
						: null;

	if (imageType !== file.type) {
		throw new ValidationError(
			"File content does not match the declared image type"
		);
	}
}

/**
 * Creates a schema for validating JPEG, PNG, WebP, and GIF image files.
 *
 * @returns A Zod schema that accepts image files up to 1 MB
 */
function validateFile() {
	const maxUploadSize = 1024 * 1024;
	return z
		.instanceof(File)
		.refine((file) => {
			return !file || file.size <= maxUploadSize;
		}, "File size must be less than 1 MB")
		.refine((file) => {
			return (
				!file ||
				imageTypes.includes(file.type)
			);
		}, "File must be a JPEG, PNG, WebP, or GIF image.");
}

export const propertySchema = z.object({
	name: z
		.string()
		.min(2, { message: "name must be at least 2 characters." })
		.max(100, "name must be less than 100 characters"),
	tagline: z
		.string()
		.min(2, {
			message: "tagline must be at least 2 characters.",
		})
		.max(100, {
			message: "tagline must be less than 100 characters.",
		}),
	price: z.coerce.number().int().min(0, {
		message: "price must be a positive number.",
	}),
	category: z.string(),
	description: z.string().refine(
		(description) => {
			const wordCount = description.split(" ").length;
			return wordCount >= 10 && wordCount <= 1000;
		},
		{
			message: "description must be between 10 and 1000 words.",
		}
	),
	country: z.string(),
	guests: z.coerce.number().int().min(0, {
		message: "guest amount must be a positive number.",
	}),
	bedrooms: z.coerce.number().int().min(0, {
		message: "bedrooms amount must be a positive number.",
	}),
	beds: z.coerce.number().int().min(0, {
		message: "beds amount must be a positive number.",
	}),
	baths: z.coerce.number().int().min(0, {
		message: "bahts amount must be a positive number.",
	}),
	amenities: z.string(),
});

export const createReviewSchema = z.object({
	propertyId: z.string(),
	rating: z.coerce.number().int().min(1).max(5),
	comment: z.string().min(10).max(1000),
});

export const pageSchema = z.coerce.number().int().min(1).max(100);

export const createBookingSchema = z
	.object({
		propertyId: z.string().uuid(),
		checkIn: z.coerce.date(),
		checkOut: z.coerce.date(),
	})
	.refine((data) => data.checkOut > data.checkIn, {
		message: "checkOut must be after checkIn",
	})
	.refine(
		(data) => getBusinessDate(data.checkIn) >= getBusinessDate(new Date()),
		{
			message: "checkIn must be today or later in the business timezone",
			path: ["checkIn"],
		}
	);

/**
 * Formats a date as a calendar date in the Asia/Tokyo time zone.
 *
 * @param date - The date to format
 * @returns The date in `YYYY-MM-DD` format
 */
function getBusinessDate(date: Date) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Tokyo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((item) => item.type === type)?.value;

	return `${part("year")}-${part("month")}-${part("day")}`;
}
