import PropertyCard from "../card/PropertyCard";
import type { PropertyCardProps } from "@/utils/types";

function PropertiesList({ properties }: { properties: PropertyCardProps[] }) {
	return (
		<section>
			{properties.map((property) => {
				return <PropertyCard key={property.id} property={property} />;
			})}
		</section>
	);
}

export default PropertiesList;
