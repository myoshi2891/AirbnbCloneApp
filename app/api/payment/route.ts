import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
	apiVersion: "2024-04-10",
});
import { auth } from "@clerk/nextjs/server";
import { type NextRequest } from "next/server";
import * as z from "zod";
import db from "@/utils/db";
import { formatDate } from "@/utils/format";

const paymentRequestSchema = z.object({
	bookingId: z.string().uuid(),
});

export const POST = async (req: NextRequest) => {
	const { userId } = await auth();
	if (!userId) {
		return Response.json(null, { status: 401, statusText: "Unauthorized" });
	}

	const applicationUrl = process.env.NEXT_PUBLIC_WEBSITE_URL;
	if (!applicationUrl) {
		return Response.json(null, {
			status: 500,
			statusText: "Internal Server Error",
		});
	}

	let requestBody: unknown;
	try {
		requestBody = await req.json();
	} catch {
		return Response.json(null, {
			status: 400,
			statusText: "Bad Request",
		});
	}

	const request = paymentRequestSchema.safeParse(requestBody);
	if (!request.success) {
		return Response.json(null, {
			status: 400,
			statusText: "Bad Request",
		});
	}

	const { bookingId } = request.data;
	const booking = await db.booking.findFirst({
		where: {
			id: bookingId,
			profileId: userId,
		},
		include: {
			property: {
				select: {
					name: true,
					image: true,
				},
			},
		},
	});
	if (!booking) {
		return Response.json(null, {
			status: 404,
			statusText: "Not Found",
		});
	}
	if (booking.paymentStatus) {
		return Response.json(null, {
			status: 404,
			statusText: "Not Found",
		});
	}

	try {
		if (booking.checkoutSessionId) {
			const session = await stripe.checkout.sessions.retrieve(
				booking.checkoutSessionId
			);

			if (session.status === "open") {
				if (!session.client_secret) {
					throw new Error("Checkout session is missing a client secret");
				}
				return Response.json({ clientSecret: session.client_secret });
			}

			if (session.status !== "expired") {
				return Response.json(null, {
					status: 409,
					statusText: "Conflict",
				});
			}
		}

		const {
			totalNights,
			orderTotal,
			checkIn,
			checkOut,
			property: { image, name },
		} = booking;

		const session = await stripe.checkout.sessions.create(
			{
				ui_mode: "embedded",
				metadata: { bookingId: booking.id },
				line_items: [
					{
						quantity: 1,
						price_data: {
							currency: "usd",
							product_data: {
								name: `${name}`,
								images: [image],
								description: `Stay in this wonderful place for ${totalNights} nights, from ${formatDate(
									checkIn
								)}. Enjoy your stay!`,
							},
							unit_amount: orderTotal * 100,
						},
					},
				],
				mode: "payment",
				return_url: `${applicationUrl.replace(/\/$/, "")}/api/confirm?session_id={CHECKOUT_SESSION_ID}`,
			},
			{
				idempotencyKey: `checkout-session-${booking.id}-${booking.checkoutSessionExpiresAt?.getTime() ?? "initial"}`,
			}
		);
		if (!session.client_secret) {
			throw new Error("Checkout session is missing a client secret");
		}
		await db.booking.update({
			where: { id: booking.id },
			data: {
				checkoutSessionId: session.id,
				checkoutSessionExpiresAt: new Date(session.expires_at * 1000),
			},
		});
		return Response.json({ clientSecret: session.client_secret });
	} catch (error) {
		console.log(error);
		return Response.json(null, {
			status: 500,
			statusText: "Internal Server Error",
		});
	}
};
