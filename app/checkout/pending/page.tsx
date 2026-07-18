import Link from "next/link";

function PendingPaymentPage() {
	return (
		<section className="mx-auto mt-16 max-w-lg rounded-md border p-8 text-center">
			<h1 className="text-2xl font-semibold">決済を確認しています</h1>
			<p className="mt-4 text-muted-foreground">
				決済が確認されると、予約は予約一覧に自動的に反映されます。
			</p>
			<Link href="/bookings" className="mt-6 inline-block underline">
				予約一覧へ
			</Link>
		</section>
	);
}

export default PendingPaymentPage;
