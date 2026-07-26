import { fetchProperties } from "@/utils/actions";
import PropertiesList from "./PropertiesList";
import EmptyList from "./EmptyList";
import type { PropertyCardProps } from "@/utils/types";
import { pageSchema } from "@/utils/schemas";
import Link from "next/link";
import { Button } from "../ui/button";
/**
 * Displays filtered properties with an empty state and pagination controls when more results are available.
 *
 * @param page - The requested page number, defaulting to the first page when invalid or omitted.
 * @returns The rendered property list, empty state, or load-more control.
 */
async function PropertiesContainer({
	category,
	search,
	page,
}: {
	category?: string;
	search?: string;
	page?: string | string[];
}) {
	const pageResult = pageSchema.safeParse(page ?? 1);
	const sanitizedPage = pageResult.success ? pageResult.data : 1;
	const { properties, hasMore }: {
		properties: PropertyCardProps[];
		hasMore: boolean;
	} = await fetchProperties({
		category,
		search,
		take: 24,
		skip: (sanitizedPage - 1) * 24,
	});

	if (properties.length === 0) {
		return (
			<EmptyList
				heading="No results."
				message="Try changing or moving some of your filters."
				btnText="Clear Filters"
			/>
		);
	}

	return (
		<>
			<PropertiesList properties={properties} />
			{hasMore && sanitizedPage < 100 && (
				<div className="mt-8 flex justify-center">
					<Button asChild variant="outline">
						<Link
							href={{
								pathname: "/",
								query: {
									...(category ? { category } : {}),
									...(search ? { search } : {}),
									page: sanitizedPage + 1,
								},
							}}
						>
							Load more
						</Link>
					</Button>
				</div>
			)}
		</>
	);
}

export default PropertiesContainer;
