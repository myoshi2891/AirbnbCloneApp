import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchProperties } = vi.hoisted(() => ({
	mockFetchProperties: vi.fn(),
}));

vi.mock("@/utils/actions", () => ({
	fetchProperties: mockFetchProperties,
}));
vi.mock("./PropertiesList", () => ({
	default: () => <div>property list</div>,
}));

import PropertiesContainer from "./PropertiesContainer";

const property = {
	id: "property_test_123",
	name: "Cabin",
	tagline: "Quiet cabin",
	country: "JP",
	price: 100,
	image: "https://example.com/cabin.png",
};

beforeEach(() => {
	vi.clearAllMocks();
	mockFetchProperties.mockResolvedValue({
		properties: [property],
		hasMore: true,
	});
});

describe("PropertiesContainer", () => {
	it("無効なpageを1へフォールバックする", async () => {
		render(await PropertiesContainer({ page: "invalid" }));

		expect(mockFetchProperties).toHaveBeenCalledWith({
			category: undefined,
			search: undefined,
			take: 24,
			skip: 0,
		});
	});

	it("page 99から検索条件を維持してpage 100へ進む", async () => {
		render(
			await PropertiesContainer({
				page: "99",
				category: "cabin",
				search: "lake",
			})
		);

		expect(screen.getByRole("link", { name: "Load more" })).toHaveAttribute(
			"href",
			"/?category=cabin&search=lake&page=100"
		);
		expect(mockFetchProperties).toHaveBeenCalledWith(
			expect.objectContaining({ skip: 2352 })
		);
	});

	it("page 100では次ページリンクを表示しない", async () => {
		render(await PropertiesContainer({ page: "100" }));

		expect(
			screen.queryByRole("link", { name: "Load more" })
		).not.toBeInTheDocument();
		expect(mockFetchProperties).toHaveBeenCalledWith(
			expect.objectContaining({ skip: 2376 })
		);
	});
});
