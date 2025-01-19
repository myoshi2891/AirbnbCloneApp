import { DateRange } from "react-day-picker";
import { Booking } from "./types";

export const defaultSelected: DateRange = {
	from: undefined,
	to: undefined,
};

export const generateBlockedPeriods = ({
	bookings,
	today,
}: {
	bookings: Booking[];
	today: Date;
}) => {
	today.setHours(0, 0, 0, 0);

	const disabledDays: DateRange[] = [
		...bookings.map((booking) => ({
			from: booking.checkIn,
			to: booking.checkOut,
		})),
		{
			from: new Date(0),
			to: new Date(today.getTime() - 24 * 60 * 60 * 1000),
		},
	];
	return disabledDays;
};

export const generateDateRange = (range: DateRange | undefined): string[] => {
	if (!range || !range.from || !range.to) return [];

	let currentDate = new Date(range.from);
	const endDate = new Date(range.to);
	const dateRange: string[] = [];

	while (currentDate <= endDate) {
		const dateString = currentDate.toISOString().split("T")[0];
		dateRange.push(dateString);
		currentDate.setDate(currentDate.getDate() + 1);
	}

	return dateRange;
};

export const generateDisabledDates = (
	disabledDays: DateRange[]
): { [key: string]: boolean } => {
	if (disabledDays.length === 0) return {};

	const disabledDates: { [key: string]: boolean } = {};
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	disabledDays.forEach((range) => {
		if (!range.from || !range.to) return;

		const endDate = new Date(range.to);
		if (endDate < today) return;

		let currentDate = new Date(range.from);
		if (currentDate < today) currentDate = new Date(today);

		while (currentDate <= endDate) {
			// if (currentDate < today) {
			// 	currentDate.setDate(currentDate.getDate() + 1);
			// 	continue;
			// }
			const dateString = currentDate.toISOString().split("T")[0];
			disabledDates[dateString] = true;
			currentDate.setDate(currentDate.getDate() + 1);
		}
	});

	return disabledDates;
};

export function caluculateDaysBetween({
	checkIn,
	checkOut,
}: {
	checkIn: Date;
	checkOut: Date;
}) {
	const diffInMs = Math.abs(checkOut.getTime() - checkIn.getTime());

	const diffInDays = diffInMs / (1000 * 60 * 60 * 24);

	return diffInDays;
}
