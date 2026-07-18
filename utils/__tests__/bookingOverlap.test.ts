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
					create: mockBookingCreate,
				},
			})
		);
	});

	it("支払済み予約と重複すると予約を作成せず空きなしを返す", async () => {
		// Arrange
		mockBookingFindFirst.mockResolvedValue({ id: "paid-booking-1" });

		// Act
		const result = await createBookingAction(bookingInput);

		// Assert
		expect(result.message).toContain("no longer available");
		expect(mockBookingCreate).not.toHaveBeenCalled();
	});

	it("支払済み予約と重複しなければ予約を作成する", async () => {
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
				paymentStatus: true,
				checkIn: { lt: bookingInput.checkOut },
				checkOut: { gt: bookingInput.checkIn },
			},
			select: { id: true },
		});
		expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
			isolationLevel: "Serializable",
		});
	});
});
