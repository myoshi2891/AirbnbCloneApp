import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FormContainer from "./FormContainer";

const { mockToast } = vi.hoisted(() => ({
	mockToast: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
	useToast: () => ({ toast: mockToast }),
}));

describe("FormContainer", () => {
	beforeEach(() => {
		mockToast.mockClear();
	});

	it("submits through useActionState and toasts the returned message", async () => {
		const action = vi.fn(async (_previousState: unknown, formData: FormData) => ({
			message: `Saved ${formData.get("name")}`,
		}));
		const { container } = render(
			<FormContainer action={action}>
				<input name="name" defaultValue="listing" />
				<button type="submit">Save</button>
			</FormContainer>
		);

		fireEvent.submit(container.querySelector("form") as HTMLFormElement);

		await waitFor(() => {
			expect(action).toHaveBeenCalledTimes(1);
			expect(mockToast).toHaveBeenCalledWith({
				description: "Saved listing",
			});
		});
		expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
	});
});
