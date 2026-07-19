"use client";

import { useSearchParams } from "next/navigation";
import React, { Suspense, useCallback } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { requestClientSecret } from "./clientSecret";
import {
	EmbeddedCheckoutProvider,
	EmbeddedCheckout,
} from "@stripe/react-stripe-js";

const stripePromise = loadStripe(
	process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string
);

function CheckoutContent() {
	const searchParams = useSearchParams();
	const bookingId = searchParams.get("bookingId");

	const fetchClientSecret = useCallback(
		() => requestClientSecret(bookingId),
		[bookingId]
	);

	const options = { fetchClientSecret };

	return (
		<div id="checkout">
			<EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
				<EmbeddedCheckout />
			</EmbeddedCheckoutProvider>
		</div>
	);
}

function CheckoutPage() {
	return (
		<Suspense fallback={<div id="checkout" />}>
			<CheckoutContent />
		</Suspense>
	);
}

export default CheckoutPage;
