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
	const cleaning = 21;
	const service = 40;
	const tax = subTotal * 0.1;
	const orderTotal = totalNights + cleaning + service + tax;
	return { totalNights, subTotal, cleaning, service, tax, orderTotal };
};
