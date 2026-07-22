import Stripe from "stripe";
import { type NextRequest, NextResponse } from "next/server";
import db from "@/utils/db";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
	apiVersion: "2024-04-10",
});

export const POST = async (req: NextRequest) => {
	const signature = req.headers.get("stripe-signature");
	const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

	if (!signature || !webhookSecret) {
		return NextResponse.json({ error: "Missing signature" }, { status: 400 });
	}

	let event: Stripe.Event;
	try {
		const rawBody = await req.text();
		event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
	} catch {
		return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
	}

	if (
		event.type === "checkout.session.completed" ||
		event.type === "checkout.session.async_payment_succeeded"
	) {
		const session = event.data.object as Stripe.Checkout.Session;
		const bookingId = session.metadata?.bookingId;

		if (session.payment_status === "paid" && bookingId) {
			await db.booking.updateMany({
				where: { id: bookingId, paymentStatus: false },
				data: { paymentStatus: true },
			});
		}
	}

	return NextResponse.json({ received: true });
};
