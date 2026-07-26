import { CardSignInButton } from "../form/Buttons";
import FavoriteToggleForm from "./FavoriteToggleForm";

/**
 * Displays the favorite control for a property based on the user's authentication state.
 *
 * @param propertyId - The identifier of the property.
 * @param favoriteId - The property's favorite identifier, or `null` if it is not favorited.
 * @param isSignedIn - Whether the user is authenticated.
 * @returns The favorite toggle form for authenticated users or a sign-in button otherwise.
 */
function FavoriteToggleButton({
	propertyId,
	favoriteId,
	isSignedIn,
}: {
	propertyId: string;
	favoriteId: string | null;
	isSignedIn: boolean;
}) {
	if (!isSignedIn) return <CardSignInButton />;

	return (
		<FavoriteToggleForm favoriteId={favoriteId} propertyId={propertyId} />
	);
}

export default FavoriteToggleButton;
