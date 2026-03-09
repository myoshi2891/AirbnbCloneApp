import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import DisclaimerBanner from "../DisclaimerBanner";

describe("DisclaimerBanner", () => {
	it("免責注意文が表示される", () => {
		render(<DisclaimerBanner />);
		expect(screen.getByText(/portfolio project/i)).toBeInTheDocument();
	});

	it("個人情報に関する免責事項が含まれる", () => {
		render(<DisclaimerBanner />);
		expect(
			screen.getByText(/personal information/i)
		).toBeInTheDocument();
	});
});
