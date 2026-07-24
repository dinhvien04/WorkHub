"use strict";

const { chromium } = require("playwright");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
require("dotenv").config();

const base = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const screenshotsDir = "C:\\Users\\nguye\\.gemini\\antigravity-ide\\brain\\85d766f6-31a8-4ea5-8ab3-c88a3f5996f2\\screenshots";

// Ensure screenshots directory exists
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function run() {
  console.log("Re-seeding database for clean E2E test environment...");
  try {
    execSync("node seed.js && npm run seed:extras", { stdio: "inherit" });
    console.log("Database seeded successfully.");
  } catch (err) {
    console.error("Failed to seed database:", err);
    process.exit(1);
  }

  console.log("Connecting to MongoDB to fetch IDs...");
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/coworking_db");
  
  // Find a Branch and a Space
  const Branch = mongoose.model("Branch", new mongoose.Schema({ Name: String, Status: String }));
  const Space = mongoose.model("Space", new mongoose.Schema({ BranchID: mongoose.Schema.Types.ObjectId, Name: String, Category: String, Status: String }));
  
  const branch = await Branch.findOne({ Status: "active" });
  if (!branch) {
    throw new Error("No active branch found in DB. Make sure you seeded the DB.");
  }
  console.log(`Using Branch: ${branch.Name} (${branch._id})`);
  
  const space = await Space.findOne({ BranchID: branch._id, Status: "available" });
  if (!space) {
    throw new Error("No active space found for branch in DB.");
  }
  console.log(`Using Space: ${space.Name} (${space._id}, Category: ${space.Category})`);
  
  await mongoose.disconnect();
  console.log("Disconnected from MongoDB. Launching Playwright browser...");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "vi-VN"
  });
  
  const page = await context.newPage();

  // Listen to browser console and page errors
  page.on("console", (msg) => {
    console.log(`[BROWSER LOG] [${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    console.error(`[BROWSER EXCEPTION] ${err.stack || err.message}`);
  });
  
  // Track all HTTP requests/responses for debugging
  page.on("request", (req) => {
    // Only log non-static files to avoid clutter
    const url = req.url();
    if (!url.includes("/css/") && !url.includes("/js/") && !url.includes("/fonts/") && !url.includes(".png") && !url.includes(".svg")) {
      console.log(`[HTTP REQUEST] ${req.method()} ${url}`);
    }
  });
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/css/") && !url.includes("/js/") && !url.includes("/fonts/") && !url.includes(".png") && !url.includes(".svg")) {
      if (response.status() >= 400) {
        console.log(`[HTTP ERROR ${response.status()}] ${response.request().method()} ${url}`);
        try {
          const body = await response.text();
          console.log(`[HTTP ERROR BODY] ${body}`);
        } catch {}
      } else if (url.includes("availability")) {
        console.log(`[HTTP SUCCESS ${response.status()}] GET ${url}`);
        try {
          const body = await response.text();
          console.log(`[AVAILABILITY RESPONSE] ${body}`);
        } catch {}
      }
    }
  });

  // Auto-dismiss dialogs (alerts, prompts)
  page.on("dialog", async (dialog) => {
    console.log(`[DIALOG] ${dialog.type()} message: "${dialog.message()}"`);
    await dialog.accept();
  });

  // Helper function to screenshot
  async function takeScreenshot(name) {
    await page.waitForTimeout(1500); // Let page render/settle
    const file = path.join(screenshotsDir, name);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`Saved screenshot: ${name}`);
  }

  // --- CUSTOMER FLOW ---
  console.log("1. Visiting Home page...");
  await page.goto(`${base}/`);
  await takeScreenshot("01_home.png");

  console.log("2. Visiting Search page...");
  await page.goto(`${base}/search`);
  await takeScreenshot("02_search.png");

  console.log("3. Visiting Login page...");
  await page.goto(`${base}/login`);
  await takeScreenshot("03_login.png");

  console.log("Logging in as Customer...");
  await page.fill("#email", "customer1@example.com");
  await page.fill("#password", "123456");
  await page.click("button[data-wh-click='handleLogin']");
  
  console.log("Waiting for redirection after login...");
  await page.waitForTimeout(3000); // wait for redirect transition and toast
  console.log("Redirection completed. Current URL: " + page.url());
  await takeScreenshot("03_customer_logged_in.png");

  console.log("4. Navigating to Booking Wizard...");
  await page.goto(`${base}/booking/wizard`);
  await takeScreenshot("04_wizard_step1.png");

  console.log("Filling Wizard Step 1...");
  // Set branch input
  await page.fill("#wz-branch", branch._id.toString());
  
  // Set tomorrow's date to avoid past date errors
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];
  await page.fill("#wz-date", tomorrowStr);
  
  // Click check availability
  await page.click("#wz-check");
  
  console.log("Waiting for space availability search results...");
  await page.waitForSelector(".space-card", { timeout: 10000 });
  
  // Select first space
  await page.click(".space-card:first-child");
  await takeScreenshot("05_wizard_step1_filled.png");
  
  // Go to step 2
  await page.click("#wz-next-1");
  console.log("Waiting for step 2...");
  await page.waitForSelector("#wz-coupon", { timeout: 5000 });
  await takeScreenshot("06_wizard_step2.png");

  console.log("Filling Wizard Step 2 (Coupon)...");
  await page.fill("#wz-coupon", "WELCOME10");
  await page.click("#wz-apply-coupon");
  await page.waitForTimeout(1000); // wait for validation response
  await takeScreenshot("07_wizard_step2_coupon.png");

  // Go to step 3
  await page.click("#wz-next-2");
  console.log("Waiting for step 3...");
  await page.waitForSelector("#wz-policy", { timeout: 5000 });
  await takeScreenshot("08_wizard_step3.png");

  console.log("Submitting booking...");
  await page.check("#wz-policy");
  await page.click("#wz-submit");
  
  // Wait for redirect to checkout or history
  await page.waitForTimeout(3000);
  console.log("Current URL after submit: " + page.url());
  
  // Let's go to History
  console.log("Visiting Customer History...");
  await page.goto(`${base}/history`);
  await takeScreenshot("09_customer_history.png");

  console.log("Visiting Customer Favorites...");
  await page.goto(`${base}/favorites`);
  await takeScreenshot("10_customer_favorites.png");

  console.log("Visiting Customer Profile...");
  await page.goto(`${base}/profile`);
  await takeScreenshot("11_customer_profile.png");

  console.log("Visiting Customer Security (2FA, sessions)...");
  await page.goto(`${base}/security`);
  await takeScreenshot("12_customer_security.png");

  // Logout customer via direct call to window.logout()
  console.log("Logging out customer...");
  // eslint-disable-next-line no-undef
  await page.evaluate(() => logout());
  await page.waitForTimeout(2000);
  console.log("Current URL after logout: " + page.url());
  await takeScreenshot("12_customer_logged_out.png");

  // --- HOST FLOW ---
  console.log("Logging in as Host...");
  await page.goto(`${base}/login`);
  await page.fill("#email", "host1@example.com");
  await page.fill("#password", "123456");
  await page.click("button[data-wh-click='handleLogin']");
  await page.waitForTimeout(3000);
  console.log("Current URL after host login: " + page.url());
  await takeScreenshot("13_host_dashboard.png");

  console.log("Visiting Host Bookings...");
  await page.goto(`${base}/host/bookings`);
  await takeScreenshot("14_host_bookings.png");

  console.log("Visiting Host Spaces...");
  await page.goto(`${base}/host/spaces`);
  await takeScreenshot("15_host_spaces.png");

  console.log("Visiting Host Calendar...");
  await page.goto(`${base}/host/calendar`);
  await takeScreenshot("16_host_calendar.png");

  console.log("Visiting Host Payments...");
  await page.goto(`${base}/host/payments`);
  await takeScreenshot("17_host_payments.png");

  console.log("Visiting Host Reception...");
  await page.goto(`${base}/host/reception`);
  await takeScreenshot("18_host_reception.png");

  console.log("Visiting Host Finance...");
  await page.goto(`${base}/host/finance`);
  await takeScreenshot("19_host_finance.png");

  console.log("Visiting Host Ops...");
  await page.goto(`${base}/host/ops`);
  await takeScreenshot("20_host_ops.png");

  // Logout host via direct call to window.logout()
  console.log("Logging out host...");
  // eslint-disable-next-line no-undef
  await page.evaluate(() => logout());
  await page.waitForTimeout(2000);
  console.log("Current URL after host logout: " + page.url());

  // --- ADMIN FLOW ---
  console.log("Logging in as Admin...");
  await page.goto(`${base}/login`);
  await page.fill("#email", "admin@example.com");
  await page.fill("#password", "123456");
  await page.click("button[data-wh-click='handleLogin']");
  await page.waitForTimeout(3000);
  console.log("Current URL after admin login: " + page.url());
  await takeScreenshot("21_admin_dashboard.png");

  console.log("Visiting Admin Users...");
  await page.goto(`${base}/admin/users`);
  await takeScreenshot("22_admin_users.png");

  console.log("Visiting Admin Hosts...");
  await page.goto(`${base}/admin/hosts`);
  await takeScreenshot("23_admin_hosts.png");

  console.log("Visiting Admin Listings...");
  await page.goto(`${base}/admin/listings`);
  await takeScreenshot("24_admin_listings.png");

  console.log("Visiting Admin SEO Redirects...");
  await page.goto(`${base}/admin/seo`);
  await takeScreenshot("25_admin_seo.png");

  console.log("Visiting Admin Feature Flags...");
  await page.goto(`${base}/admin/flags`);
  await takeScreenshot("26_admin_flags.png");

  console.log("Visiting Admin Activity Logs...");
  await page.goto(`${base}/admin/activitylog`);
  await takeScreenshot("27_admin_activitylog.png");

  console.log("Visiting Admin System Health...");
  await page.goto(`${base}/admin/health`);
  await takeScreenshot("28_admin_health.png");

  await browser.close();
  console.log("All E2E checks and screenshots completed successfully!");
}

run().catch((err) => {
  console.error("E2E Test Failed with error:", err);
  process.exit(1);
});
