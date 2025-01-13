"use client";
import { useState } from "react";
import { Calendar } from "../ui/calendar";
import { DateRange } from "react-day-picker";

function BookingCalender() {
	const currentDate = new Date();
	const defaultSelected: DateRange = {
		from: undefined,
		to: undefined,
	};

	const [range, setRange] = useState<DateRange | undefined>(defaultSelected);
	return (
		<Calendar
			mode="range"
			defaultMonth={currentDate}
			selected={range}
			onSelect={setRange}
		/>
	);
}

export default BookingCalender;
