"use client";
import { useState } from "react";
import { SubmitButton } from "../form/Buttons";
import FormContainer from "../form/FormContainer";
import { Card } from "../ui/card";
import RatingInput from "../form/RatingInput";
import TextAreaInput from "../form/TextAreaInput";
import { Button } from "../ui/button";
import { createReviewAction } from "@/utils/actions";

function SubmitReview({ propertyId }: { propertyId: string }) {
	const [isReviewFormVisible, setIsReviewFormVisible] = useState(false);

	return (
		<div className="mt-8">
			<Button onClick={() => setIsReviewFormVisible((prev) => !prev)}>
				Leave a Review
			</Button>
			{isReviewFormVisible && (
				<Card className="p-8 mt-8">
					<FormContainer action={createReviewAction}>
						<input
							type="hidden"
							name="propertyId"
							value={propertyId}
						/>
						<RatingInput name="rating" />
						<TextAreaInput
							name="comment"
							labelText="your thoughts on this review"
							defaultValue="Amazing Place!!"
						/>
						<SubmitButton text="submit" className="mt-4" />
					</FormContainer>
				</Card>
			)}
		</div>
	);
}

export default SubmitReview;
