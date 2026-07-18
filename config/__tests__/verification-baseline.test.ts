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
});
