import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockCurrentUser,
	mockDb,
	mockRedirect,
	mockRevalidatePath,
} = vi.hoisted(() => ({
	mockCurrentUser: vi.fn(),
	mockDb: {
		$transaction: vi.fn(),
		booking: {
			count: vi.fn(),
			delete: vi.fn(),
			findMany: vi.fn(),
		},
		favorite: {
			create: vi.fn(),
			deleteMany: vi.fn(),
		},
		profile: {
			count: vi.fn(),
		},
		property: {
			count: vi.fn(),
			findUnique: vi.fn(),
		},
		review: {
			create: vi.fn(),
			delete: vi.fn(),
		},
	},
	mockRedirect: vi.fn((url: string) => {
		throw new Error(`REDIRECT:${url}`);
	}),
	mockRevalidatePath: vi.fn(),
}));

vi.mock("@/utils/db", () => ({ default: mockDb }));
vi.mock("@/utils/supabase", () => ({ uploadImage: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({
	auth: vi.fn(),
	clerkClient: { users: { updateUserMetadata: vi.fn() } },
	currentUser: mockCurrentUser,
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import {
	createBookingAction,
	deleteBookingAction,
	fetchBookings,
	fetchStats,
} from "@/utils/actions";

const authenticatedUser = {
	id: "user_test_123",
	privateMetadata: { hasProfile: true },
	emailAddresses: [{ emailAddress: "test@example.com" }],
	imageUrl: "",
};

beforeEach(() => {
	vi.clearAllMocks();
	mockCurrentUser.mockResolvedValue(authenticatedUser);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("authorization guards", () => {
	it("rejects unauthenticated users before querying bookings", async () => {
		mockCurrentUser.mockResolvedValue(null);

		await expect(fetchBookings()).rejects.toThrow("must be logged in");

		expect(mockDb.booking.findMany).not.toHaveBeenCalled();
	});

	it("redirects users without a profile before querying bookings", async () => {
		mockCurrentUser.mockResolvedValue({
			...authenticatedUser,
			privateMetadata: { hasProfile: false },
		});

		await expect(fetchBookings()).rejects.toThrow("REDIRECT:/profile/create");

		expect(mockRedirect).toHaveBeenCalledWith("/profile/create");
		expect(mockDb.booking.findMany).not.toHaveBeenCalled();
	});

	it("redirects non-admin users before querying dashboard stats", async () => {
		vi.stubEnv("ADMIN_USER_ID", "user_admin_test");

		await expect(fetchStats()).rejects.toThrow("REDIRECT:/");

		expect(mockRedirect).toHaveBeenCalledWith("/");
		expect(mockDb.profile.count).not.toHaveBeenCalled();
		expect(mockDb.property.count).not.toHaveBeenCalled();
		expect(mockDb.booking.count).not.toHaveBeenCalled();
	});

	it("returns dashboard stats for the configured admin", async () => {
		vi.stubEnv("ADMIN_USER_ID", authenticatedUser.id);
		mockDb.profile.count.mockResolvedValue(7);
		mockDb.property.count.mockResolvedValue(11);
		mockDb.booking.count.mockResolvedValue(13);

		await expect(fetchStats()).resolves.toEqual({
			usersCount: 7,
			propertiesCount: 11,
			bookingsCount: 13,
		});

		expect(mockDb.booking.count).toHaveBeenCalledWith({
			where: { paymentStatus: true },
		});
	});
});

describe("booking actions", () => {
	it("returns a not-found result without starting a transaction", async () => {
		mockDb.property.findUnique.mockResolvedValue(null);

		await expect(
			createBookingAction({
				propertyId: "550e8400-e29b-41d4-a716-446655440000",
				checkIn: new Date("2030-06-20"),
				checkOut: new Date("2030-06-25"),
			})
		).resolves.toEqual({ message: "Property not found..." });

		expect(mockDb.$transaction).not.toHaveBeenCalled();
	});

	it("scopes booking deletion to the authenticated user", async () => {
		mockDb.booking.delete.mockResolvedValue({ id: "booking_test_123" });

		await expect(
			deleteBookingAction({ bookingId: "booking_test_123" })
		).resolves.toEqual({ message: "Booking deleted successfully!" });

		expect(mockDb.booking.delete).toHaveBeenCalledWith({
			where: {
				id: "booking_test_123",
				profileId: authenticatedUser.id,
			},
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/bookings");
	});
});
