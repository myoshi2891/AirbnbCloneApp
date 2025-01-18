"use client";

import { Calendar } from "@/components/ui/calendar";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { DateRange } from "react-day-picker";
import { useProperty } from "@/utils/store";
import {
	generateDisabledDates,
	generateBlockedPeriods,
	generateDateRange,
	defaultSelected,
} from "@/utils/calender";

function BookingCalender() {
	const currentDate = new Date();
	const [range, setRange] = useState<DateRange | undefined>(defaultSelected);

	useEffect(() => {
		useProperty.setState({ range });
	}, [range]);

	return (
		<Calendar
			mode="range"
			defaultMonth={currentDate}
			selected={range}
			onSelect={setRange}
			className="mb-4"
		/>
	);
}

export default BookingCalender;
