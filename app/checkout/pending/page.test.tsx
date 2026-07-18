import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PendingPaymentPage from "./page";

describe("PendingPaymentPage", () => {
	it("決済確認中であることと予約一覧への導線を表示する", () => {
		render(<PendingPaymentPage />);

		expect(
			screen.getByRole("heading", { name: "決済を確認しています" })
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"決済が確認されると、予約は予約一覧に自動的に反映されます。"
			)
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "予約一覧へ" })).toHaveAttribute(
			"href",
			"/bookings"
		);
	});
});
