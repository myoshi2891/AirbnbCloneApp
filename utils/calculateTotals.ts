import { caluculateDaysBetween } from "./calender";
type BookingDetails = {
	checkIn: Date;
	checkOut: Date;
	price: number;
};

export const calculateTotals = ({
	checkIn,
	checkOut,
	price,
}: BookingDetails) => {
	const totalNights = caluculateDaysBetween({ checkIn, checkOut });
	const subTotal = totalNights * price;
	const cleaning = 2;
	const service = 4;
	const tax = subTotal * 0.1;
	const orderTotal = subTotal + cleaning + service + tax;
	return { totalNights, subTotal, cleaning, service, tax, orderTotal };
};
