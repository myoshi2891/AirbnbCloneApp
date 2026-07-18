import { createClient } from "@supabase/supabase-js";
import { validateImageContent } from "./schemas";

const bucket = "home-away-app";

const url = process.env.SUPABASE_URL as string;
const key = process.env.SUPABASE_KEY as string;

const supabase = createClient(url, key);

const imageExtensions: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
};

export const uploadImage = async (image: File) => {
	await validateImageContent(image);
	const extension = imageExtensions[image.type];
	if (!extension) throw new Error("Unsupported image type");

	const newName = `${crypto.randomUUID()}.${extension}`;
	const { data, error } = await supabase.storage
		.from(bucket)
		.upload(newName, image, { cacheControl: "3600" });
	if (error) throw error;
	if (!data) throw new Error("Image upload failed");
	return supabase.storage.from(bucket).getPublicUrl(newName).data.publicUrl;
};
