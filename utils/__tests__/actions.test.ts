import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockAuth,
	mockCurrentUser,
	mockClerkClient,
	mockDb,
	mockRedirect,
	mockRevalidatePath,
	mockRevalidateTag,
	mockUploadImage,
	mockUpdateUserMetadata,
} = vi.hoisted(() => ({
	mockAuth: vi.fn(),
	mockCurrentUser: vi.fn(),
	mockClerkClient: vi.fn(),
	mockDb: {
		$transaction: vi.fn(),
		booking: {
			aggregate: vi.fn(),
			count: vi.fn(),
			delete: vi.fn(),
			findMany: vi.fn(),
			groupBy: vi.fn(),
		},
		favorite: {
			create: vi.fn(),
			deleteMany: vi.fn(),
			findMany: vi.fn(),
		},
		profile: {
			count: vi.fn(),
			create: vi.fn(),
		},
		property: {
			count: vi.fn(),
			create: vi.fn(),
			delete: vi.fn(),
			findMany: vi.fn(),
			findUnique: vi.fn(),
			update: vi.fn(),
		},
		review: {
			create: vi.fn(),
			delete: vi.fn(),
			groupBy: vi.fn(),
		},
	},
	mockRedirect: vi.fn((url: string) => {
		throw new Error(`REDIRECT:${url}`);
	}),
	mockRevalidatePath: vi.fn(),
	mockRevalidateTag: vi.fn(),
	mockUploadImage: vi.fn(),
	mockUpdateUserMetadata: vi.fn(),
}));

vi.mock("@/utils/db", () => ({ default: mockDb }));
vi.mock("@/utils/supabase", () => ({ uploadImage: mockUploadImage }));
vi.mock("@clerk/nextjs/server", () => ({
	auth: mockAuth,
	clerkClient: mockClerkClient,
	currentUser: mockCurrentUser,
}));
vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
	revalidateTag: mockRevalidateTag,
	unstable_cache: (callback: (...args: unknown[]) => unknown) => callback,
}));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import {
	createBookingAction,
	createPropertyAction,
	createProfileAction,
	createReviewAction,
	deleteBookingAction,
	deleteReviewAction,
	deleteRentalAction,
	fetchFavoriteIdsForProperties,
	fetchBookings,
	fetchProperties,
	fetchPropertyRatings,
	fetchRentals,
	fetchStats,
	toggleFavoriteAction,
	updatePropertyAction,
	updatePropertyImageAction,
} from "@/utils/actions";

const authenticatedUser = {
	id: "user_test_123",
	privateMetadata: { hasProfile: true },
	emailAddresses: [{ emailAddress: "test@example.com" }],
	imageUrl: "",
};

beforeEach(() => {
	vi.clearAllMocks();
	mockAuth.mockResolvedValue({ userId: authenticatedUser.id });
	mockCurrentUser.mockResolvedValue(authenticatedUser);
	mockClerkClient.mockResolvedValue({
		users: { updateUserMetadata: mockUpdateUserMetadata },
	});
	mockUploadImage.mockResolvedValue(
		"https://storage.example/property/image.png"
	);
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

	it("updates Clerk metadata through the asynchronous client after profile creation", async () => {
		mockDb.profile.create.mockResolvedValue({ id: "profile_test_123" });
		const formData = new FormData();
		formData.set("firstName", "John");
		formData.set("lastName", "Doe");
		formData.set("username", "john_doe");

		await expect(createProfileAction({}, formData)).rejects.toThrow("REDIRECT:/");

		expect(mockClerkClient).toHaveBeenCalledOnce();
		expect(mockUpdateUserMetadata).toHaveBeenCalledWith(authenticatedUser.id, {
			privateMetadata: { hasProfile: true },
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

describe("favorite actions", () => {
	it("未ログイン時は一括お気に入り取得でDBへアクセスしない", async () => {
		mockAuth.mockResolvedValue({ userId: null });

		await expect(
			fetchFavoriteIdsForProperties(["property_test_123"])
		).resolves.toEqual({
			favoriteIds: new Map(),
			isSignedIn: false,
		});

		expect(mockDb.favorite.findMany).not.toHaveBeenCalled();
	});

	it("ログイン時は対象物件のお気に入りを一括取得する", async () => {
		mockDb.favorite.findMany.mockResolvedValue([
			{ id: "favorite_test_123", propertyId: "property_test_123" },
		]);

		const result = await fetchFavoriteIdsForProperties([
			"property_test_123",
			"property_test_456",
		]);

		expect(mockDb.favorite.findMany).toHaveBeenCalledOnce();
		expect(mockDb.favorite.findMany).toHaveBeenCalledWith({
			where: {
				propertyId: {
					in: ["property_test_123", "property_test_456"],
				},
				profileId: authenticatedUser.id,
			},
			select: { id: true, propertyId: true },
		});
		expect(result.isSignedIn).toBe(true);
		expect(result.favoriteIds.get("property_test_123")).toBe(
			"favorite_test_123"
		);
	});

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

describe("batched property queries", () => {
	it("指定件数より1件多く取得してhasMoreを返す", async () => {
		mockDb.property.findMany.mockResolvedValue(
			Array.from({ length: 25 }, (_, index) => ({ id: `property_${index}` }))
		);

		const result = await fetchProperties({ take: 24, skip: 48 });

		expect(result.properties).toHaveLength(24);
		expect(result.hasMore).toBe(true);
		expect(mockDb.property.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: 25, skip: 48 })
		);
	});

	it("取得件数が指定件数以下ならhasMoreをfalseにする", async () => {
		mockDb.property.findMany.mockResolvedValue(
			Array.from({ length: 24 }, (_, index) => ({ id: `property_${index}` }))
		);

		await expect(fetchProperties({ take: 24 })).resolves.toMatchObject({
			hasMore: false,
		});
	});

	it("物件ごとの評価を1回のgroupByで取得する", async () => {
		mockDb.review.groupBy.mockResolvedValue([
			{
				propertyId: "property_test_123",
				_avg: { rating: 4.25 },
				_count: { rating: 3 },
			},
		]);

		const ratings = await fetchPropertyRatings([
			"property_test_123",
			"property_test_456",
		]);

		expect(mockDb.review.groupBy).toHaveBeenCalledOnce();
		expect(mockDb.review.groupBy).toHaveBeenCalledWith({
			by: ["propertyId"],
			_avg: { rating: true },
			_count: { rating: true },
			where: {
				propertyId: {
					in: ["property_test_123", "property_test_456"],
				},
			},
		});
		expect(ratings.get("property_test_123")).toEqual({
			rating: "4.3",
			count: 3,
		});
	});

	it("rental集計を1回のgroupByで取得する", async () => {
		mockDb.property.findMany.mockResolvedValue([
			{ id: "property_test_123", name: "Cabin", price: 100 },
			{ id: "property_test_456", name: "Cottage", price: 200 },
		]);
		mockDb.booking.groupBy.mockResolvedValue([
			{
				propertyId: "property_test_123",
				_sum: { totalNights: 4, orderTotal: 400 },
			},
		]);

		await expect(fetchRentals()).resolves.toEqual([
			{
				id: "property_test_123",
				name: "Cabin",
				price: 100,
				totalNightsSum: 4,
				orderTotalSum: 400,
			},
			{
				id: "property_test_456",
				name: "Cottage",
				price: 200,
				totalNightsSum: null,
				orderTotalSum: null,
			},
		]);

		expect(mockDb.booking.groupBy).toHaveBeenCalledOnce();
		expect(mockDb.booking.aggregate).not.toHaveBeenCalled();
	});
});

describe("property cache invalidation", () => {
	it("物件作成後にカタログキャッシュを失効する", async () => {
		mockDb.property.create.mockResolvedValue({ id: "property_test_123" });

		await expect(
			createPropertyAction({}, createPropertyFormData())
		).rejects.toThrow("REDIRECT:/");

		expect(mockRevalidateTag).toHaveBeenCalledWith("properties");
	});

	it("物件更新後にカタログキャッシュを失効する", async () => {
		mockDb.property.update.mockResolvedValue({ id: "property_test_123" });
		const formData = createPropertyFormData();
		formData.set("id", "property_test_123");

		await expect(updatePropertyAction({}, formData)).resolves.toEqual({
			message: "Update Successful!!",
		});

		expect(mockRevalidateTag).toHaveBeenCalledWith("properties");
	});

	it("物件画像更新後にカタログキャッシュを失効する", async () => {
		mockDb.property.update.mockResolvedValue({ id: "property_test_123" });
		const formData = new FormData();
		formData.set("id", "property_test_123");
		formData.set(
			"image",
			new File(["image"], "image.png", { type: "image/png" })
		);

		await expect(updatePropertyImageAction({}, formData)).resolves.toEqual({
			message: "Property Image Updated Successfully!!",
		});

		expect(mockRevalidateTag).toHaveBeenCalledWith("properties");
	});

	it("物件削除後にカタログキャッシュを失効する", async () => {
		mockDb.property.delete.mockResolvedValue({ id: "property_test_123" });

		await expect(
			deleteRentalAction({ propertyId: "property_test_123" })
		).resolves.toEqual({ message: "Rental deleted successfully!" });

		expect(mockRevalidateTag).toHaveBeenCalledWith("properties");
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

function createPropertyFormData() {
	const formData = new FormData();
	formData.set("name", "Mountain Cabin");
	formData.set("tagline", "Quiet cabin in the mountains");
	formData.set("price", "100");
	formData.set("category", "cabin");
	formData.set(
		"description",
		"A quiet cabin with beautiful views and plenty of room for guests"
	);
	formData.set("country", "JP");
	formData.set("guests", "4");
	formData.set("bedrooms", "2");
	formData.set("beds", "3");
	formData.set("baths", "1");
	formData.set("amenities", "wifi");
	formData.set(
		"image",
		new File(["image"], "image.png", { type: "image/png" })
	);
	return formData;
}
