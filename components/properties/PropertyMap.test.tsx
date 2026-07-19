import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PropertyMap from "./PropertyMap";

describe("PropertyMap", () => {
	it("initializes and removes one Leaflet map in Strict Mode", () => {
		const { container, unmount } = render(
			<StrictMode>
				<PropertyMap countryCode="US" />
			</StrictMode>
		);

		expect(container.querySelectorAll(".leaflet-container")).toHaveLength(1);
		expect(container.querySelector(".leaflet-map-pane")).not.toBeNull();
		expect(() => unmount()).not.toThrow();
	});
});
