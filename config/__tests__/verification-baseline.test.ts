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
});
