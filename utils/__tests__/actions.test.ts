import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockCurrentUser,
	mockDb,
	mockRedirect,
	mockRevalidatePath,
	mockUpdateUserMetadata,
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
			create: vi.fn(),
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
	mockUpdateUserMetadata: vi.fn(),
}));

vi.mock("@/utils/db", () => ({ default: mockDb }));
vi.mock("@/utils/supabase", () => ({ uploadImage: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({
	auth: vi.fn(),
	clerkClient: { users: { updateUserMetadata: mockUpdateUserMetadata } },
	currentUser: mockCurrentUser,
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import {
	createBookingAction,
	createProfileAction,
	createReviewAction,
	deleteBookingAction,
	deleteReviewAction,
	fetchBookings,
	fetchStats,
	toggleFavoriteAction,
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
	vi.restoreAllMocks();
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

describe("error handling", () => {
	it("replaces internal database details with a fixed client message", async () => {
		const databaseError = new Error(
			"Invalid `prisma.booking.delete()` invocation: secret_column"
		);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		mockDb.booking.delete.mockRejectedValue(databaseError);

		await expect(
			deleteBookingAction({ bookingId: "booking_test_123" })
		).resolves.toEqual({
			message: "An unexpected error occurred. Please try again.",
		});

		expect(consoleError).toHaveBeenCalledTimes(1);
		expect(consoleError).toHaveBeenCalledWith(databaseError);
	});

	it("preserves booking validation messages", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			createBookingAction({
				propertyId: "550e8400-e29b-41d4-a716-446655440000",
				checkIn: new Date("2030-06-25"),
				checkOut: new Date("2030-06-20"),
			})
		).resolves.toEqual({ message: "checkOut must be after checkIn" });

		expect(mockDb.property.findUnique).not.toHaveBeenCalled();
		expect(mockDb.$transaction).not.toHaveBeenCalled();
	});

	it("preserves the profile login message", async () => {
		mockCurrentUser.mockResolvedValue(null);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(createProfileAction({}, new FormData())).resolves.toEqual({
			message: "Please login to create a profile",
		});

		expect(mockDb.profile.create).not.toHaveBeenCalled();
		expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
	});

	it("guides profile creation when the account has no email address", async () => {
		mockCurrentUser.mockResolvedValue({
			...authenticatedUser,
			emailAddresses: [],
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const formData = new FormData();
		formData.set("firstName", "John");
		formData.set("lastName", "Doe");
		formData.set("username", "john_doe");

		await expect(createProfileAction({}, formData)).resolves.toEqual({
			message: "Your account has no email address. Please add one and retry.",
		});

		expect(mockDb.profile.create).not.toHaveBeenCalled();
		expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalledTimes(1);
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

describe("favorite actions", () => {
	it("creates a favorite for the authenticated user", async () => {
		mockDb.favorite.create.mockResolvedValue({ id: "favorite_test_123" });

		await expect(
			toggleFavoriteAction({
				propertyId: "property_test_123",
				favoriteId: null,
				pathname: "/properties/property_test_123",
			})
		).resolves.toEqual({ message: "Added to favorites" });

		expect(mockDb.favorite.create).toHaveBeenCalledWith({
			data: {
				propertyId: "property_test_123",
				profileId: authenticatedUser.id,
			},
		});
		expect(mockDb.favorite.deleteMany).not.toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith(
			"/properties/property_test_123"
		);
	});

	it("deletes only the authenticated user's favorite", async () => {
		mockDb.favorite.deleteMany.mockResolvedValue({ count: 1 });

		await expect(
			toggleFavoriteAction({
				propertyId: "property_test_123",
				favoriteId: "favorite_test_123",
				pathname: "/favorites",
			})
		).resolves.toEqual({ message: "Removed from favorites" });

		expect(mockDb.favorite.deleteMany).toHaveBeenCalledWith({
			where: {
				id: "favorite_test_123",
				profileId: authenticatedUser.id,
			},
		});
		expect(mockDb.favorite.create).not.toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/favorites");
	});
});

describe("review actions", () => {
	it("creates a validated review for the authenticated user", async () => {
		const formData = new FormData();
		formData.set("propertyId", "property_test_123");
		formData.set("rating", "5");
		formData.set("comment", "A wonderful stay with excellent hospitality.");
		formData.set("ignored", "not persisted");
		mockDb.review.create.mockResolvedValue({ id: "review_test_123" });

		await expect(createReviewAction({}, formData)).resolves.toEqual({
			message: "Review submitted successfully!",
		});

		expect(mockDb.review.create).toHaveBeenCalledWith({
			data: {
				propertyId: "property_test_123",
				rating: 5,
				comment: "A wonderful stay with excellent hospitality.",
				profileId: authenticatedUser.id,
			},
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith(
			"/properties/property_test_123"
		);
	});

	it("scopes review deletion to the authenticated user", async () => {
		mockDb.review.delete.mockResolvedValue({ id: "review_test_123" });

		await expect(
			deleteReviewAction({ reviewId: "review_test_123" })
		).resolves.toEqual({ message: "delete reviews" });

		expect(mockDb.review.delete).toHaveBeenCalledWith({
			where: {
				id: "review_test_123",
				profileId: authenticatedUser.id,
			},
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/reviews");
	});
});
