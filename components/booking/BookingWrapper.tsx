"use client";

import { useProperty } from "@/utils/store";
import { Booking } from "@/utils/types";
import BookingCalender from "./BookingCalender";
import BookingContainer from "./BookingContainer";
import { useEffect } from "react";

type BookingWrapperProps = {
	propertyId: string;
	price: number;
	bookings: Booking[];
};

function BookingWrapper({ propertyId, price, bookings }: BookingWrapperProps) {
	useEffect(() => {
		useProperty.setState({
			propertyId,
			price,
			bookings,
		});
	}, []);

	return (
		<>
			<BookingCalender />
			<BookingContainer />
		</>
	);
}

export default BookingWrapper;
