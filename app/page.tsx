import LoadingCards from "@/components/card/LoadingCards";
import CategoriesList from "@/components/home/CategoriesList";
import PropertiesContainer from "@/components/home/PropertiesContainer";
import { Suspense } from "react";

/**
 * Render the home page section showing categories and property listings filtered by search parameters.
 *
 * @param searchParams - A promise that resolves to an object with optional `category` and `search` strings used to filter displayed content.
 * @returns A React `<section>` element containing `CategoriesList` and a `Suspense`-wrapped `PropertiesContainer` (which uses `LoadingCards` as its fallback).
 */
async function HomePage({
	searchParams,
}: {
	searchParams: Promise<{ category?: string; search?: string }>;
}) {
	const { category, search } = await searchParams;
	return (
		<section>
			<CategoriesList category={category} search={search} />
			<Suspense fallback={<LoadingCards />}>
				<PropertiesContainer category={category} search={search} />
			</Suspense>
		</section>
	);
}

export default HomePage;
