import LoadingCards from "@/components/card/LoadingCards";
import CategoriesList from "@/components/home/CategoriesList";
import PropertiesContainer from "@/components/home/PropertiesContainer";
import { Suspense } from "react";

/**
 * Renders the home page using category, search, and pagination query parameters.
 *
 * @param searchParams - Query parameters used to filter and paginate the displayed properties.
 * @returns The home page content.
 */
async function HomePage({
	searchParams,
}: {
	searchParams: Promise<{
		category?: string | string[];
		search?: string | string[];
		page?: string | string[];
	}>;
}) {
	const { category, search, page } = await searchParams;
	const normalizedCategory =
		typeof category === "string" ? category : undefined;
	const normalizedSearch = typeof search === "string" ? search : undefined;
	return (
		<section>
			<CategoriesList
				category={normalizedCategory}
				search={normalizedSearch}
			/>
			<Suspense fallback={<LoadingCards />}>
				<PropertiesContainer
					category={normalizedCategory}
					search={normalizedSearch}
					page={page}
				/>
			</Suspense>
		</section>
	);
}

export default HomePage;
