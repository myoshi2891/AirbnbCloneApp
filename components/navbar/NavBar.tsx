import NavSearch from "./NavSearch";
import LinksDropdown from "./LinksDropdown";
import DarkMode from "./DarkMode";
import Logo from "./Logo";
import { Suspense } from "react";

/**
 * Renders the site's navigation bar with search, theme, and link controls.
 *
 * @returns The navigation bar element.
 */
function NavBar() {
	return (
		<nav className="border-b">
			<div className="container flex flex-col sm:flex-row justify-between sm:items-center flex-wrap gap-4 py-8">
				<Logo />
				<Suspense
					fallback={<div className="h-10 w-full max-w-xs" aria-hidden="true" />}
				>
					<NavSearch />
				</Suspense>
				<div className="flex gap-4 items-center">
					<DarkMode />
					<LinksDropdown />
				</div>
			</div>
		</nav>
	);
}

export default NavBar;
