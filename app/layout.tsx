import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/navbar/NavBar";
import DisclaimerBanner from "@/components/banner/DisclaimerBanner";
import Providers from "./providers";
import { ClerkProvider } from "@clerk/nextjs";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
	title: "Home Away",
	description: "Feel at home, away from home",
};

/**
 * Root layout for the application that provides global UI chrome and context.
 *
 * Wraps the page content with authentication and app-level providers, renders a site-wide
 * disclaimer banner and navigation, and applies the global Inter font to the document body.
 *
 * @param children - The page content to render inside the layout's main container.
 * @returns The root React element containing the HTML document structure and app-level providers.
 */
export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<ClerkProvider>
			<html lang="en" suppressHydrationWarning>
				<body className={inter.className}>
					<DisclaimerBanner />
					<Providers>
						<NavBar />
						<main className="container py-10">{children}</main>
					</Providers>
				</body>
			</html>
		</ClerkProvider>
	);
}
