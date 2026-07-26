import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
	apiVersion: "2024-04-10",
});
import { redirect } from "next/navigation";

import { type NextRequest, NextResponse } from "next/server";
import db from "@/utils/db";

export const GET = async (req: NextRequest) => {
	const { searchParams } = new URL(req.url);
	const session_id = searchParams.get("session_id") as string;
	let redirectPath = "/bookings";
	try {
		const session = await stripe.checkout.sessions.retrieve(session_id);
		const bookingId = session.metadata?.bookingId;
		if (session.status !== "complete" || !bookingId) {
			throw new Error("Something went wrong..");
		}

		if (session.payment_status === "paid") {
			await db.booking.updateMany({
				where: { id: bookingId, paymentStatus: false },
				data: { paymentStatus: true },
			});
		} else {
			redirectPath = `/checkout/pending?session_id=${encodeURIComponent(session_id)}`;
		}
	} catch (error) {
		console.log(error);
		return NextResponse.json(null, {
			status: 500,
			statusText: "Internal Server Error",
		});
	}
	redirect(redirectPath);
};
