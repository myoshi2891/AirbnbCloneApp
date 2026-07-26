import Image from "next/image";
import Link from "next/link";
import CountryFlagAndName from "./CountryFlagAndName";
import PropertyRating from "./PropertyRating";
import { PropertyCardProps } from "@/utils/types";
import { formatCurrency } from "@/utils/format";
import FavoriteToggleButton from "./FavoriteToggleButton";

/**
 * Renders a property listing card with property details, rating, location, and favorite controls.
 *
 * @param property - The property details displayed in the card
 * @param rating - The property's rating and review count
 * @param favoriteId - The identifier of the property's existing favorite, or `null` if it is not favorited
 * @param isSignedIn - Whether the current user is signed in
 */
function PropertyCard({
	property,
	rating,
	favoriteId,
	isSignedIn,
}: {
	property: PropertyCardProps;
	rating: { rating: string | number; count: number };
	favoriteId: string | null;
	isSignedIn: boolean;
}) {
	const { name, image, price } = property;
	const { country, id: propertyId, tagline } = property;

	return (
		<article className="group relative">
			<Link href={`/properties/${propertyId}`}>
				<div className="relative mb-2 overflow-hidden rounded-md h-[300px]">
					<Image
						src={image}
						fill
						sizes="(max-width:768px) 100vw, 50vw"
						alt={name}
						className="rounded-md object-cover transform group-hover:scale-110 transition-transform duration-500"
						priority
					/>
				</div>
				<div className="flex justify-between items-center">
					<h3 className="text-sm font-semibold mt-1">
						{name.substring(0, 30)}
					</h3>
					{/* property rating */}
					<PropertyRating inPage={false} {...rating} />
				</div>
				<p className="text-sm mt-1 text-muted-foreground">
					{tagline.substring(0, 40)}
				</p>
				<div className="flex justify-between items-center mt-1">
					<p className="text-sm mt-1">
						<span className="font-semibold">
							{formatCurrency(price) + " "}
						</span>
						per a night
					</p>
					{/* country and flag */}
					<CountryFlagAndName countryCode={country} />
				</div>
			</Link>
			<div className="absolute top-5 right-5 z-5">
				{/* favorite toggle button */}
				<FavoriteToggleButton
					propertyId={propertyId}
					favoriteId={favoriteId}
					isSignedIn={isSignedIn}
				/>
			</div>
		</article>
	);
}

export default PropertyCard;
