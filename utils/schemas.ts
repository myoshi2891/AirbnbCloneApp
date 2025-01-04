import * as z from "zod";
import { ZodSchema } from "zod";

export const profileSchema = z.object({
	// firstName: z.string().max(5, { message: "Max length is 5 characters" }),
	firstName: z.string().min(2),
	lastName: z.string().min(2),
	username: z.string().min(2),
});
