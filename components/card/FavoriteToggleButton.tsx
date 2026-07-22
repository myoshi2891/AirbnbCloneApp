import { CardSignInButton } from "../form/Buttons";
import FavoriteToggleForm from "./FavoriteToggleForm";

/**
 * Render the favorite toggle UI for a property, or a sign-in button when the user is not authenticated.
 *
 * @param propertyId - The identifier of the property to toggle as a favorite
 * @returns A React element: `FavoriteToggleForm` with the property's favorite id when the user is signed in, or `CardSignInButton` to prompt sign-in otherwise
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
