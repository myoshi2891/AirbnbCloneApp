/** @type {import('next').NextConfig} */
const nextConfig = {
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "img.clerk.com",
			},
			{
				protocol: "https",
				hostname: "ojabjjalovfwipjmmadj.supabase.co",
			},
		],
	},
	// webpackDevMiddleware: (config) => {
	// 	config.watchOptions = {
	// 		poll: 1000, // 1秒ごとに変更を確認
	// 		aggregateTimeout: 300, // 変更検知後、再ビルド開始までの遅延
	// 	};
	// 	return config;
	// },
	// reactStrictMode: true,
	// env: {
	// 	CUSTOM_VARIABLE: "value",
	// },
};


export default nextConfig;
