import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.TOKEN ?? "";
const OUT = "shots";

const CHROME = "C:/Users/Frank/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch({
	executablePath: CHROME,
	// Chromium's fake capture device synthesises a tone, which is enough to
	// exercise MediaRecorder -> upload -> transcribe -> insert.
	args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const context = await browser.newContext({
	viewport: { width: 1280, height: 860 },
	deviceScaleFactor: 2,
	locale: "zh-CN",
	colorScheme: "light",
	permissions: ["microphone"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(BASE, { waitUntil: "networkidle" });
const tokenInput = page.locator("#token");
if (await tokenInput.count()) {
	await tokenInput.fill(TOKEN);
	await page.locator('button[type="submit"]').click();
	await page.waitForTimeout(1500);
}

const newSession = page.getByRole("button", { name: "新建会话" });
if (await newSession.isVisible().catch(() => false)) {
	await newSession.click();
	await page.waitForTimeout(700);
}

// Start recording
await page.locator('button[aria-label="语音输入"]').click();
await page.waitForTimeout(2600);
await page.screenshot({ path: `${OUT}/20-recording.png` });
console.log("recording UI visible:", await page.locator('button:has-text("完成")').isVisible());

// Finish -> transcribe
await page.locator('button:has-text("完成")').click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/21-transcribing.png` });

// Wait for the textarea to receive text (or for a toast telling us nothing was heard)
await page
	.waitForFunction(
		() => {
			const ta = document.querySelector("textarea");
			return (ta && ta.value.trim().length > 0) || document.body.innerText.includes("没有识别到语音内容");
		},
		{ timeout: 60_000 },
	)
	.catch(() => console.log("warning: neither transcript nor empty-result toast appeared"));

const value = await page.locator("textarea").first().inputValue();
const toast = await page.locator("body").innerText();
console.log("textarea value:", JSON.stringify(value));
console.log("saw empty-result toast:", toast.includes("没有识别到语音内容"));
await page.screenshot({ path: `${OUT}/22-transcribed.png` });

console.log("errors:", errors.length ? errors.slice(0, 5) : "none");
await browser.close();
