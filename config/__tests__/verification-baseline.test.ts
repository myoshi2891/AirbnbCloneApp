import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");

describe("verification baseline", () => {
	it("defines a dedicated typecheck script", () => {
		const packageJson = JSON.parse(
			fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
		) as { scripts?: Record<string, string> };

		expect(packageJson.scripts?.typecheck).toBe("tsc --noEmit");
	});

	it("runs the verification baseline in CI", () => {
		const workflow = fs.readFileSync(
			path.join(repoRoot, ".github", "workflows", "ci.yml"),
			"utf8"
		);

		expect(workflow).toMatch(
			/on:\s*\n\s+push:\s*\n\s+branches: \[main\]\s*\n\s+pull_request:/
		);
		expect(workflow).toContain("uses: oven-sh/setup-bun@v2");

		const commands = [
			"bun install --frozen-lockfile",
			"bunx prisma generate",
			"bun run lint",
			"bun run typecheck",
			"bun run test:run",
		];
		let previousIndex = -1;

		for (const command of commands) {
			const commandIndex = workflow.indexOf(command);

			expect(commandIndex).toBeGreaterThan(previousIndex);
			previousIndex = commandIndex;
		}
	});

	it("provides a safe environment template", () => {
		const template = fs.readFileSync(
			path.join(repoRoot, ".env.example"),
			"utf8"
		);
		const variables = Object.fromEntries(
			template
				.split("\n")
				.filter((line) => line.length > 0 && !line.startsWith("#"))
				.map((line) => {
					const separatorIndex = line.indexOf("=");

					return [
						line.slice(0, separatorIndex),
						line.slice(separatorIndex + 1),
					];
				})
		);

		expect(variables).toEqual({
			DATABASE_URL:
				'"postgresql://user:password@host:5432/dbname?pgbouncer=true"',
			DIRECT_URL: '"postgresql://user:password@host:5432/dbname"',
			NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '"pk_test_..."',
			CLERK_SECRET_KEY: '"sk_test_..."',
			NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: '"pk_test_..."',
			STRIPE_SECRET_KEY: '"sk_test_..."',
			STRIPE_WEBHOOK_SECRET: '"whsec_..."',
			SUPABASE_URL: '"https://your-project.supabase.co"',
			SUPABASE_KEY: '"your-anon-or-service-key"',
			ADMIN_USER_ID: '"user_..."',
		});
	});
});
