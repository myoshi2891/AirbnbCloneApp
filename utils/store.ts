import { create } from "zustand";
import { Booking } from "./types";
import { DateRange } from "react-day-picker";

type PropertyState = {
	propertyId: string;
	price: number;
	bookings: Booking[];
	range: DateRange | undefined;
};

export const useProperty = create<PropertyState>(() => {
	return {
		propertyId: "",
		price: 0,
		bookings: [],
		range: undefined,
	};
});
