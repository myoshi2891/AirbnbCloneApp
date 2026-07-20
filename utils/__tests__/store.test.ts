import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProperty } from "../store";

const initialState = {
	propertyId: "",
	price: 0,
	bookings: [],
	range: undefined,
};

describe("useProperty", () => {
	beforeEach(() => {
		useProperty.setState(initialState, true);
	});

	it("初期状態を返す", () => {
		// Arrange & Act
		const state = useProperty.getState();

		// Assert
		expect(state).toEqual(initialState);
	});

	it("setState で range を更新する", () => {
		// Arrange
		const range = { from: new Date("2030-06-20"), to: new Date("2030-06-25") };

		// Act
		useProperty.setState({ range });

		// Assert
		expect(useProperty.getState().range).toEqual(range);
	});

	it("setState で propertyId・price・bookings を部分更新する", () => {
		// Arrange
		const bookings = [
			{ checkIn: new Date("2030-06-20"), checkOut: new Date("2030-06-25") },
		];

		// Act
		useProperty.setState({ propertyId: "abc", price: 120, bookings });

		// Assert
		const state = useProperty.getState();
		expect(state.propertyId).toBe("abc");
		expect(state.price).toBe(120);
		expect(state.bookings).toEqual(bookings);
		// 指定していないキーは維持される
		expect(state.range).toBeUndefined();
	});

	it("state 全体を返すセレクタが無限再レンダリングを起こさない", () => {
		// Arrange: BookingForm / ConfirmBooking が使う (state) => state 形式
		let renderCount = 0;
		const { result } = renderHook(() =>
			useProperty((state) => {
				renderCount += 1;
				return state;
			})
		);
		const rendersAfterMount = renderCount;

		// Act
		act(() => {
			useProperty.setState({ price: 250 });
		});

		// Assert: 更新は反映され、再レンダリングは有限回で収束する
		expect(result.current.price).toBe(250);
		expect(renderCount).toBeGreaterThan(rendersAfterMount);
		expect(renderCount).toBeLessThan(rendersAfterMount + 10);
	});

	it("プリミティブを返すセレクタが該当キーの更新のみで再評価される", () => {
		// Arrange: BookingCalender が使う (state) => state.bookings 形式
		const { result } = renderHook(() =>
			useProperty((state) => state.bookings)
		);
		const initialBookings = result.current;

		// Act: 無関係なキーを更新
		act(() => {
			useProperty.setState({ price: 999 });
		});

		// Assert: bookings の参照は変わらない
		expect(result.current).toBe(initialBookings);
	});
});
