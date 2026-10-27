import type { Attachment } from "./model";
import { nextKey } from "./model";

/** Longest edge we send to the model. Larger images waste tokens with no benefit. */
const MAX_EDGE = 1568;
/** Below this, we keep the original bytes and format untouched. */
const PASS_THROUGH_BYTES = 700 * 1024;
/** Hard ceiling for a single attachment (base64 length is ~1.37x this). */
const HARD_LIMIT_BYTES = 8 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"image/heic",
	"image/heif",
]);

export async function fileToAttachment(file: File): Promise<Attachment> {
	if (!file.type.startsWith("image/")) {
		throw new Error("只支持图片文件");
	}
	if (file.size > HARD_LIMIT_BYTES) {
		throw new Error(`图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），请压缩后再试`);
	}

	// SVG and other non-raster formats cannot be re-encoded meaningfully.
	const isRaster = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
	if (!isRaster || file.size <= PASS_THROUGH_BYTES) {
		const data = await blobToBase64(file);
		return {
			id: nextKey("att"),
			mimeType: file.type || "image/png",
			data,
			name: file.name,
		};
	}

	try {
		const compressed = await compressImage(file);
		return {
			id: nextKey("att"),
			mimeType: compressed.mimeType,
			data: compressed.data,
			name: file.name,
			width: compressed.width,
			height: compressed.height,
		};
	} catch {
		// Canvas can fail on exotic formats (HEIC in some browsers); fall back to raw.
		const data = await blobToBase64(file);
		return { id: nextKey("att"), mimeType: file.type || "image/png", data, name: file.name };
	}
}

async function compressImage(
	file: File,
): Promise<{ data: string; mimeType: string; width: number; height: number }> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("canvas unavailable");

	// JPEG has no alpha; paint white so transparent PNGs don't turn black.
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, width, height);
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(bitmap, 0, 0, width, height);
	bitmap.close?.();

	const hasAlpha = file.type === "image/png";
	const mimeType = hasAlpha ? "image/png" : "image/jpeg";
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob((result) => resolve(result), mimeType, hasAlpha ? undefined : 0.88),
	);
	if (!blob) throw new Error("image encode failed");

	// If PNG re-encode got bigger than the source, prefer the original bytes.
	if (blob.size >= file.size && file.size <= PASS_THROUGH_BYTES * 3) {
		const data = await blobToBase64(file);
		return { data, mimeType: file.type, width: bitmap.width, height: bitmap.height };
	}

	const data = await blobToBase64(blob);
	return { data, mimeType, width, height };
}

export function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = String(reader.result ?? "");
			const comma = result.indexOf(",");
			resolve(comma === -1 ? result : result.slice(comma + 1));
		};
		reader.onerror = () => reject(new Error("读取文件失败"));
		reader.readAsDataURL(blob);
	});
}

export function attachmentUrl(attachment: Attachment): string {
	return `data:${attachment.mimeType};base64,${attachment.data}`;
}

/** Extracts image files from a paste or drop event. */
export function imagesFromDataTransfer(data: DataTransfer | null): File[] {
	if (!data) return [];
	const files: File[] = [];
	for (const item of Array.from(data.items ?? [])) {
		if (item.kind !== "file") continue;
		const file = item.getAsFile();
		if (file && file.type.startsWith("image/")) files.push(file);
	}
	if (files.length === 0) {
		for (const file of Array.from(data.files ?? [])) {
			if (file.type.startsWith("image/")) files.push(file);
		}
	}
	return files;
}

export function downscaleForPreview(attachment: Attachment): string {
	return attachmentUrl(attachment);
}
