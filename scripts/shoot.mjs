import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.TOKEN ?? "";
const OUT = process.env.OUT ?? "shots";
const THEME = process.env.THEME ?? "light";
fs.mkdirSync(OUT, { recursive: true });

const CHROME = "C:/Users/Frank/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 2,
	locale: "zh-CN",
	colorScheme: THEME,
});
const page = await context.newPage();

const errors = [];
page.on("console", (msg) => {
	if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/01-login.png` });

const input = page.locator("#token");
if (await input.count()) {
	await input.fill(TOKEN);
	await page.locator('button[type="submit"]').click();
	await page.waitForTimeout(1600);
}

// Fresh session so the shots show a clean timeline.
const newSession = page.getByRole("button", { name: "新建会话" });
if (await newSession.isVisible().catch(() => false)) {
	await newSession.click();
	await page.waitForTimeout(900);
}
await page.screenshot({ path: `${OUT}/02-empty.png` });

const textarea = page.locator("textarea").first();
await textarea.fill("执行 ls 看看当前目录都有什么，然后用一句话总结这个项目是做什么的。");
await page.keyboard.press("Enter");

await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/03-streaming.png` });

// Wait until the run actually finishes (the stop button disappears).
await page
	.waitForSelector('button:has-text("停止")', { state: "detached", timeout: 180_000 })
	.catch(() => console.log("warning: run did not settle in 180s"));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/04-done.png`, fullPage: false });

// Expand the tool card if present.
const toolButton = page.locator("button", { hasText: "执行命令" }).first();
if (await toolButton.count()) {
	await toolButton.click();
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${OUT}/05-tool.png` });
}

await page.locator('button[aria-label="切换主题"]').click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/06-alt-theme.png` });

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/07-mobile.png` });

console.log("console errors:", errors.length ? errors.slice(0, 8) : "none");
await browser.close();
