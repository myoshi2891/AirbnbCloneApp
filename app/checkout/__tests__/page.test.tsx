import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => {
	const mockCreate = vi.fn();
	class StripeMock {
		checkout = {
			sessions: {
				create: mockCreate,
			},
		};
	}
	return {
		StripeMock,
		mockCreate,
		loadStripe: vi.fn(() => Promise.resolve(new StripeMock())),
		get: vi.fn<(key: string) => string | null>(() => "550e8400-e29b-41d4-a716-446655440001"),
		// EmbeddedCheckoutProvider に渡された props を記録する
		providerProps: [] as Array<Record<string, unknown>>,
	};
});

vi.mock("@stripe/stripe-js", () => ({
	loadStripe: mocks.loadStripe,
}));

vi.mock("next/navigation", () => ({
	useSearchParams: () => ({ get: mocks.get }),
}));

vi.mock("@stripe/react-stripe-js", () => ({
	EmbeddedCheckoutProvider: ({
		children,
		...props
	}: {
		children: React.ReactNode;
	} & Record<string, unknown>) => {
		mocks.providerProps.push(props);
		return <div data-testid="provider">{children}</div>;
	},
	EmbeddedCheckout: () => <div data-testid="embedded-checkout" />,
}));

import CheckoutPage from "../page";

type ProviderOptions = { fetchClientSecret: () => Promise<string> };

describe("CheckoutPage", () => {
	beforeEach(() => {
		mocks.providerProps.length = 0;
		mocks.get.mockReturnValue("550e8400-e29b-41d4-a716-446655440001");
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("EmbeddedCheckout を Provider の子として描画する", () => {
		// Act
		render(<CheckoutPage />);

		// Assert
		expect(screen.getByTestId("provider")).toBeInTheDocument();
		expect(screen.getByTestId("embedded-checkout")).toBeInTheDocument();
	});

	it("Provider に stripe インスタンスと fetchClientSecret を渡す", () => {
		// Act
		render(<CheckoutPage />);

		// Assert
		const props = mocks.providerProps.at(-1);
		expect(props).toBeDefined();
		expect(props?.stripe).toBeDefined();
		const options = props?.options as ProviderOptions;
		expect(typeof options.fetchClientSecret).toBe("function");
	});

	it("fetchClientSecret が URL の bookingId で client secret を取得する", async () => {
		// Arrange
		mocks.get.mockReturnValue("550e8400-e29b-41d4-a716-446655440042");
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ clientSecret: "cs_test_123" }),
		}));
		vi.stubGlobal("fetch", fetchMock);

		// Act
		render(<CheckoutPage />);
		const options = mocks.providerProps.at(-1)?.options as ProviderOptions;
		const secret = await options.fetchClientSecret();

		// Assert
		expect(secret).toBe("cs_test_123");
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/payment",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ bookingId: "550e8400-e29b-41d4-a716-446655440042" }),
			})
		);
	});

	it("bookingId が変わらない限り fetchClientSecret の参照を保つ", () => {
		// Arrange
		const { rerender } = render(<CheckoutPage />);
		const first = (mocks.providerProps.at(-1)?.options as ProviderOptions)
			.fetchClientSecret;

		// Act
		rerender(<CheckoutPage />);
		const second = (mocks.providerProps.at(-1)?.options as ProviderOptions)
			.fetchClientSecret;

		// Assert: useCallback の依存配列が正しく機能している
		expect(second).toBe(first);
	});

	it("client secret が取得できない場合にエラーを伝播する", async () => {
		// Arrange: /api/payment が失敗するケース
		const fetchMock = vi.fn(async () => ({
			ok: false,
			status: 500,
			json: async () => ({}),
		}));
		vi.stubGlobal("fetch", fetchMock);

		// Act
		render(<CheckoutPage />);
		const options = mocks.providerProps.at(-1)?.options as ProviderOptions;

		// Assert: 握りつぶさずに例外を投げる
		await expect(options.fetchClientSecret()).rejects.toThrow(
			"Failed to initialize checkout (500)"
		);
	});
});
