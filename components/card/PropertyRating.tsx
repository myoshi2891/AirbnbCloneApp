import { FaStar } from "react-icons/fa";
/**
 * Displays a property rating with its review count.
 *
 * @param rating - The rating value to display.
 * @param count - The number of reviews.
 * @param inPage - Whether to include the review label and use in-page styling.
 * @returns The rating display, or `null` when the review count is zero.
 */
function PropertyRating({
	rating,
	count,
	inPage,
}: {
	rating: string | number;
	count: number;
	inPage: boolean;
}) {
	if (count === 0) return null;

	const className = `flex gap-1 items-center ${
		inPage ? "text-md" : "text-xs"
	}`;
	const countText = count > 1 ? "reviews" : "review";
	const countValue = `(${count}) ${inPage ? countText : ""}`;

	return (
		<span className={className}>
			<FaStar className="w-3 h-3" />
			{rating} {countValue}
		</span>
	);
}

export default PropertyRating;
