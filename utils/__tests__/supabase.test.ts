import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockCreateClient,
	mockFrom,
	mockGetPublicUrl,
	mockUpload,
	mockValidateImageContent,
} = vi.hoisted(() => {
	const mockFrom = vi.fn();
	return {
		mockFrom,
		mockCreateClient: vi.fn(() => ({ storage: { from: mockFrom } })),
		mockGetPublicUrl: vi.fn(),
		mockUpload: vi.fn(),
		mockValidateImageContent: vi.fn(),
	};
});

vi.mock("@supabase/supabase-js", () => ({
	createClient: mockCreateClient,
}));

vi.mock("../schemas", () => ({
	validateImageContent: mockValidateImageContent,
}));

import { uploadImage } from "../supabase";

describe("uploadImage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv("SUPABASE_URL", "https://storage.example");
		vi.stubEnv("SUPABASE_KEY", "test-storage-key");
		mockFrom.mockReturnValue({
			upload: mockUpload,
			getPublicUrl: mockGetPublicUrl,
		});
		mockValidateImageContent.mockResolvedValue(undefined);
		mockUpload.mockResolvedValue({ data: { path: "uploaded" }, error: null });
		mockGetPublicUrl.mockReturnValue({
			data: { publicUrl: "https://storage.example/images/uploaded.png" },
		});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("クライアントのファイル名を使わずにサーバー生成キーでアップロードする", async () => {
		const image = new File(["png"], "../../untrusted-name.png", {
			type: "image/png",
		});

		await expect(uploadImage(image)).resolves.toBe(
			"https://storage.example/images/uploaded.png"
		);

		expect(mockValidateImageContent).toHaveBeenCalledWith(image);
		const [objectKey] = mockUpload.mock.calls[0];
		expect(objectKey).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/
		);
		expect(objectKey).not.toContain(image.name);
		expect(mockUpload).toHaveBeenCalledWith(objectKey, image, {
			cacheControl: "3600",
			contentType: "image/png",
		});
	});

	it("コンテンツ検証に失敗したファイルをアップロードしない", async () => {
		const image = new File(["not an image"], "image.png", {
			type: "image/png",
		});
		mockValidateImageContent.mockRejectedValue(
			new Error("invalid image content")
		);

		await expect(uploadImage(image)).rejects.toThrow("invalid image content");

		expect(mockCreateClient).not.toHaveBeenCalled();
		expect(mockUpload).not.toHaveBeenCalled();
	});

	it("Supabase の upload error をそのまま送出する", async () => {
		const error = new Error("storage unavailable");
		const image = new File(["png"], "image.png", { type: "image/png" });
		mockUpload.mockResolvedValue({ data: null, error });

		await expect(uploadImage(image)).rejects.toBe(error);
		expect(mockGetPublicUrl).not.toHaveBeenCalled();
	});

	it("ランタイムのストレージ設定がない場合は明示的に失敗する", async () => {
		vi.stubEnv("SUPABASE_URL", "");
		const image = new File(["png"], "image.png", { type: "image/png" });

		await expect(uploadImage(image)).rejects.toThrow(
			"Supabase storage is not configured"
		);
		expect(mockCreateClient).not.toHaveBeenCalled();
	});
});
