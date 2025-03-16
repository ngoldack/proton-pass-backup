import { chromium, devices } from "playwright";
import type { BrowserContext, Page } from "playwright";

import { CronJob } from 'cron';


const email = Bun.env.PROTON_EMAIL;
const password = Bun.env.PROTON_PASSWORD;
const cron = Bun.env.CRON || "* * * * *"; // Default every minute

const backupPath = Bun.env.BACKUP_PATH || "./backups";
const tz = Bun.env.TZ || "Europe/Berlin";

const storagePath = "playwright/.auth.json";

if (!email || !password) {
    throw new Error("Please provide PROTON_EMAIL and PROTON_PASSWORD env variables");
}

const browser = await chromium.launch({
    headless: true,
    slowMo: 50,
    args: ["--start-maximized"],
});

const reauth = async (context: BrowserContext, page: Page) => {
    console.log("Reauthenticating");
    await page.getByTestId("input-input-element").fill(password);
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL("https://pass.proton.me/u/**", {
        waitUntil: "networkidle"
    })
    await page.waitForTimeout(5_000);
    await context.storageState({
        path: storagePath
    })
    console.log("Reauthenticated");
}

const auth = async (context: BrowserContext, page: Page) => {
    console.log("Authenticating");

    await page.getByTestId("input-input-element").fill(email);
    await page.getByRole("checkbox", { name: "Keep me signed in" }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForTimeout(1000);

    await page.getByTestId("input-input-element").fill(password);
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.getByTestId('tab-header-authenticator-app-button').click();

    var totp = "";
    const prompt = "Enter TOTP: ";
    process.stdout.write(prompt);
    for await (const line of console) {
        totp = line;
        break;
    }

    console.log("TOTP: ", totp);
    if (totp.length !== 6) {
        throw new Error("TOTP must be 6 digits");
    }

    await page.getByRole('textbox', { name: 'Enter verification code. Digit 1.' }).fill(totp[0]);
    await page.getByRole('textbox', { name: 'Enter verification code. Digit 2.' }).fill(totp[1]);
    await page.getByRole('textbox', { name: 'Enter verification code. Digit 3.' }).fill(totp[2]);
    await page.getByRole('textbox', { name: 'Enter verification code. Digit 4.' }).fill(totp[3]);
    await page.getByRole('textbox', { name: 'Enter verification code. Digit 5.' }).fill(totp[4]);
    await page.getByRole('textbox', { name: 'Enter verification code. Digit 6.' }).fill(totp[5]);

    await page.waitForURL("https://pass.proton.me/u/**")
    await page.waitForTimeout(10_000);
    await context.storageState({
        path: storagePath
    })

    console.log("Authenticated");
}



const exportData = async (page: Page) => {
    console.log("Exporting data");
    await page.locator('div').filter({ hasText: /^Dunkel$/ }).first().click();
    await page.getByRole('button', { name: 'Auswählen' }).click();

    await page.getByRole("button", { name: "Weitere Optionen" }).nth(3).click();
    await page.getByRole("button", { name: "Exportieren" }).click();

    await page.getByText('JSON', { exact: true }).click();
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "Exportieren" }).click();
    await page.getByTestId("input-input-element").fill(password);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Authentifizieren" }).click();
    const download = await downloadPromise;

    await download.saveAs(`${backupPath}/${new Date().toISOString().split(".")[0]}.zip`);
    console.log("Exported data");
}

const job = new CronJob(
	cron,
	async function () {
        console.log("Starting job");
        const context = await browser.newContext({
            ...devices["Desktop Chrome"],
            storageState: storagePath
        });
        const page = await context.newPage();
        await page.goto("https://pass.proton.me/u/1", {
            waitUntil: "networkidle",
        });
        
        const url = page.url();
        console.log(url);

        if (url.includes("reauth")) {
            console.log("Reauthenticating");
            await reauth(context, page);
        } else {
            console.log("Authenticating");
            await auth(context, page);
        }

        await exportData(page);
        await context.close();
	}, // onTick
	null, // onComplete
	false, // start
	tz
);

if (Bun.env.RUN_NOW) {
    job.fireOnTick();
} else {
    job.start();
    console.log("Job started");
}
