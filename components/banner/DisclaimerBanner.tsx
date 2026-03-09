/**
 * Renders a full-width, yellow-themed disclaimer banner with centered small text.
 *
 * @returns A JSX element containing the disclaimer message about the portfolio project and data handling.
 */
function DisclaimerBanner() {
	return (
		<div className="w-full bg-yellow-50 border-b border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800">
			<p className="text-center text-xs text-yellow-800 dark:text-yellow-200 py-2 px-4">
				This website is a portfolio project and is not actively
				operated. We do not take any responsibility for the handling of
				personal information or provided data.
			</p>
		</div>
	);
}

export default DisclaimerBanner;
