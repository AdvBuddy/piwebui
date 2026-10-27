import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.TOKEN ?? "";
const OUT = "shots";
const IMAGE = process.env.IMAGE ?? "shots/01-login.png";

const CHROME = "C:/Users/Frank/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({
	viewport: { width: 1280, height: 860 },
	deviceScaleFactor: 2,
	locale: "zh-CN",
	colorScheme: "light",
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

await page.getByRole("button", { name: "新建会话" }).click();
await page.waitForTimeout(800);

// Switch to a vision-capable model.
await page.locator('button[title="切换模型"]').click();
await page.waitForTimeout(400);
await page.getByText(/glm-4\.6v/i).first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/10-model-switched.png` });

// Attach an image.
await page.locator('input[type="file"]').setInputFiles(IMAGE);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/11-image-attached.png` });

const textarea = page.locator("textarea").first();
await textarea.fill("这张截图里是什么界面？用一句话描述，不要调用工具。");
await page.keyboard.press("Enter");

await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/12-image-sending.png` });

await page
	.waitForSelector('button:has-text("停止")', { state: "detached", timeout: 120_000 })
	.catch(() => console.log("warning: did not settle"));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/13-image-done.png` });

const body = await page.locator("body").innerText();
console.log("--- page text (tail) ---");
console.log(body.slice(-600));
console.log("errors:", errors.length ? errors.slice(0, 5) : "none");

await browser.close();
