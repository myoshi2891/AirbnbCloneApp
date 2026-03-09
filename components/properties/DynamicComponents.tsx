"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

export const DynamicMap = dynamic(
	() => import("@/components/properties/PropertyMap"),
	{
		ssr: false,
		loading: () => <Skeleton className="h-[400px] w-full" />,
	}
);

export const DynamicBookingWrapper = dynamic(
	() => import("@/components/booking/BookingWrapper"),
	{
		ssr: false,
		loading: () => <Skeleton className="h-[200px] w-full" />,
	}
);
