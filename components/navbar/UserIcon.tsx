import { LuUser } from "react-icons/lu";
import { fetchProfileImage } from "@/utils/actions";

async function UserIcon() {
	const profileImage = await fetchProfileImage();

	if (profileImage) {
		return (
			<img
				src={profileImage}
				className="w-6 h-6 rounded-full object-cover"
			/>
		);
	}

	return (
		<LuUser className="w-6 h-6 bg-primary rounded-full text-white">
			UserIcon
		</LuUser>
	);
}

export default UserIcon;
