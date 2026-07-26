import PropertyCard from "../card/PropertyCard";
import type { PropertyCardProps } from "@/utils/types";
import {
	fetchFavoriteIdsForProperties,
	fetchPropertyRatings,
} from "@/utils/actions";


/**
 * Renders property cards with rating and favorite state.
 *
 * @param properties - The properties to display.
 */
async function PropertiesList({ properties }: { properties: PropertyCardProps[] }) {
	const propertyIds = properties.map((property) => property.id);
	const [ratings, favoriteState] = await Promise.all([
		fetchPropertyRatings(propertyIds),
		fetchFavoriteIdsForProperties(propertyIds),
	]);

	return (
		<section className="mt-4 gap-8 grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{properties.map((property) => {
				return (
					<PropertyCard
						key={property.id}
						property={property}
						rating={
							ratings.get(property.id) ?? { rating: 0, count: 0 }
						}
						favoriteId={
							favoriteState.favoriteIds.get(property.id) ?? null
						}
						isSignedIn={favoriteState.isSignedIn}
					/>
				);
			})}
		</section>
	);
}

export default PropertiesList;
