import { FaHeart } from "react-icons/fa";
import { Button } from "../ui/button";
import { auth } from "@clerk/nextjs/server";
import { CardSignInButton } from "../form/Buttons";
import { fetchFavoriteId } from "@/utils/actions";
import FavoriteToggleForm from "./FavoriteToggleForm";

/**
 * Render the favorite toggle UI for a property, or a sign-in button when the user is not authenticated.
 *
 * @param propertyId - The identifier of the property to toggle as a favorite
 * @returns A React element: `FavoriteToggleForm` with the property's favorite id when the user is signed in, or `CardSignInButton` to prompt sign-in otherwise
 */
async function FavoriteToggleButton({ propertyId }: { propertyId: string }) {
	const { userId } = await auth();
	if (!userId) return <CardSignInButton />;

	const favoriteId = await fetchFavoriteId({ propertyId });

	return (
		<FavoriteToggleForm favoriteId={favoriteId} propertyId={propertyId} />
	);
}

export default FavoriteToggleButton;
