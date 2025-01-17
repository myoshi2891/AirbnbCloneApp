import { LuUser } from "react-icons/lu";
import { fetchProfileImage } from "@/utils/actions";
import Image from "next/image";

async function UserIcon() {
	const profileImage = await fetchProfileImage();

	if (profileImage) {
		return (
			<Image
				width={6}
				height={6}
				alt="profile image"
				src={profileImage}
				className="w-6 h-6 rounded-full object-cover"
				priority
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
