import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockBookingCreate,
	mockBookingDeleteMany,
	mockBookingFindFirst,
	mockFindUnique,
	mockRedirect,
	mockTransaction,
} = vi.hoisted(() => ({
	mockBookingCreate: vi.fn(),
	mockBookingDeleteMany: vi.fn(),
	mockBookingFindFirst: vi.fn(),
	mockFindUnique: vi.fn(),
	mockRedirect: vi.fn(),
	mockTransaction: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
	currentUser: vi.fn(async () => ({
		id: "user-1",
		privateMetadata: { hasProfile: true },
	})),
}));

vi.mock("next/navigation", () => ({
	redirect: (...args: unknown[]) => {
		mockRedirect(...args);
		throw new Error("NEXT_REDIRECT");
	},
}));

vi.mock("@/utils/db", () => ({
	default: {
		$transaction: mockTransaction,
		booking: {
			create: mockBookingCreate,
			deleteMany: mockBookingDeleteMany,
		},
		property: {
			findUnique: mockFindUnique,
		},
	},
}));

vi.mock("@/utils/supabase", () => ({
	uploadImage: vi.fn(),
}));

import { createBookingAction } from "@/utils/actions";
import db from "@/utils/db";

const bookingInput = {
	propertyId: "550e8400-e29b-41d4-a716-446655440000",
	checkIn: new Date("2030-06-20"),
	checkOut: new Date("2030-06-25"),
};

describe("createBookingAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(db.property.findUnique).mockResolvedValue({ price: 100 } as never);
		mockTransaction.mockImplementation(async (callback) =>
			callback({
				booking: {
					findFirst: mockBookingFindFirst,
					deleteMany: mockBookingDeleteMany,
					create: mockBookingCreate,
				},
			})
		);
	});

	it("既存予約と重複すると予約を作成せず空きなしを返す", async () => {
		// Arrange
		mockBookingFindFirst.mockResolvedValue({ id: "paid-booking-1" });

		// Act
		const result = await createBookingAction(bookingInput);

		// Assert
		expect(result.message).toContain("no longer available");
		expect(mockBookingCreate).not.toHaveBeenCalled();
		expect(mockBookingDeleteMany).not.toHaveBeenCalled();
	});

	it("既存予約と重複しなければ予約を作成する", async () => {
		// Arrange
		mockBookingFindFirst.mockResolvedValue(null);
		mockBookingCreate.mockResolvedValue({ id: "booking-1" });

		// Act
		await expect(createBookingAction(bookingInput)).rejects.toThrow("NEXT_REDIRECT");

		// Assert
		expect(mockBookingCreate).toHaveBeenCalledWith({
			data: {
				checkIn: bookingInput.checkIn,
				checkOut: bookingInput.checkOut,
				propertyId: bookingInput.propertyId,
				profileId: "user-1",
				orderTotal: 556,
				totalNights: 5,
			},
		});
	});

	it("連続する予約を重複として扱わない半開区間条件を使用する", async () => {
		// Arrange
		mockBookingFindFirst.mockResolvedValue(null);
		mockBookingCreate.mockResolvedValue({ id: "booking-1" });

		// Act
		await expect(createBookingAction(bookingInput)).rejects.toThrow("NEXT_REDIRECT");

		// Assert
		expect(mockBookingFindFirst).toHaveBeenCalledWith({
			where: {
				propertyId: bookingInput.propertyId,
				checkIn: { lt: bookingInput.checkOut },
				checkOut: { gt: bookingInput.checkIn },
			},
			select: { id: true },
		});
		expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
			isolationLevel: "Serializable",
		});
		expect(mockBookingDeleteMany).toHaveBeenCalledWith({
			where: {
				profileId: "user-1",
				paymentStatus: false,
				NOT: {
					checkoutSessionId: { not: null },
					checkoutSessionExpiresAt: { gt: expect.any(Date) },
				},
			},
		});
	});
});

const databaseIt =
	process.env.RUN_DATABASE_TESTS === "true" && process.env.TEST_DATABASE_URL
		? it
		: it.skip;

databaseIt(
	"実DBで同一日程の同時予約は最大1件だけ成功する",
	async () => {
		const previousDatabaseUrl = process.env.DATABASE_URL;
		process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
		const fixtureId = crypto.randomUUID();
		const profileId = `booking-overlap-${fixtureId}`;
		vi.resetModules();
		vi.doUnmock("@/utils/db");
		vi.doMock("@clerk/nextjs/server", () => ({
			currentUser: vi.fn(async () => ({
				id: profileId,
				privateMetadata: { hasProfile: true },
			})),
		}));
		vi.doMock("next/navigation", () => ({
			redirect: () => {
				throw new Error("NEXT_REDIRECT");
			},
		}));
		vi.doMock("@/utils/supabase", () => ({ uploadImage: vi.fn() }));

		const { default: actualDb } = await import("@/utils/db");
		const { createBookingAction: createActualBooking } = await import(
			"@/utils/actions"
		);
		let propertyId: string | undefined;

		try {
			await actualDb.profile.create({
				data: {
					clerkId: profileId,
					firstName: "Booking",
					lastName: "Overlap",
					username: `overlap-${fixtureId}`,
					email: `${fixtureId}@example.test`,
					profileImage: "https://example.test/profile.png",
				},
			});
			const property = await actualDb.property.create({
				data: {
					name: "Concurrent booking fixture",
					tagline: "Fixture property for transaction testing",
					category: "test",
					image: "https://example.test/property.png",
					country: "JP",
					description: "A property used only to verify concurrent booking transactions.",
					price: 100,
					guests: 1,
					bedrooms: 1,
					beds: 1,
					baths: 1,
					amenities: "[]",
					profileId,
				},
			});
			propertyId = property.id;

			const results = await Promise.allSettled(
				Array.from({ length: 2 }, () =>
					createActualBooking({
						propertyId: property.id,
						checkIn: new Date("2030-06-20"),
						checkOut: new Date("2030-06-25"),
					})
				)
			);
			const successfulBookings = results.filter(
				(result) =>
					result.status === "rejected" &&
					result.reason instanceof Error &&
					result.reason.message === "NEXT_REDIRECT"
			);

			expect(successfulBookings).toHaveLength(1);
			expect(
				await actualDb.booking.count({ where: { propertyId: property.id } })
			).toBe(1);
		} finally {
			if (propertyId) {
				await actualDb.property.delete({ where: { id: propertyId } });
			}
			await actualDb.profile.delete({ where: { clerkId: profileId } }).catch(() => undefined);
			await actualDb.$disconnect();
			if (previousDatabaseUrl === undefined) {
				delete process.env.DATABASE_URL;
			} else {
				process.env.DATABASE_URL = previousDatabaseUrl;
			}
		}
	},
	30_000
);
