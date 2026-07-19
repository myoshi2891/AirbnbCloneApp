type PaymentResponse = {
	clientSecret?: unknown;
};

export async function requestClientSecret(
	bookingId: string | null
): Promise<string> {
	const response = await fetch("/api/payment", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ bookingId }),
	});

	if (!response.ok) {
		throw new Error(`Failed to initialize checkout (${response.status})`);
	}

	const data = (await response.json()) as PaymentResponse;
	if (typeof data.clientSecret !== "string" || data.clientSecret.length === 0) {
		throw new Error("Payment response did not include a client secret");
	}

	return data.clientSecret;
}
