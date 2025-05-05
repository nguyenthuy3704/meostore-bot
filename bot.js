const puppeteer = require("puppeteer-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
const randomUseragent = require("random-useragent");
const axios = require("axios");
const fs = require("fs");
const config = require("./config");

puppeteer.use(stealth);

["keywords.txt", "log.txt", "removed.txt"].forEach((f) => {
  if (!fs.existsSync(f)) fs.writeFileSync(f, "");
});

let keywords = fs.readFileSync("keywords.txt", "utf-8")
  .split("\n")
  .map((k) => k.trim())
  .filter(Boolean);

const domainVIP = "meostore.netlify.app";
const logFile = "log.txt";

const delay = (ms) => new Promise((res) => setTimeout(res, ms));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min) + min);

function writeLog(message) {
  const time = new Date().toLocaleString("vi-VN");
  fs.appendFileSync(logFile, `[${time}] ${message}\n`);
}

function removeKeyword(keyword) {
  keywords = keywords.filter((k) => k !== keyword);
  fs.writeFileSync("keywords.txt", keywords.join("\n"), "utf-8");
  fs.appendFileSync("removed.txt", `[${new Date().toLocaleString('vi-VN')}] Removed: "${keyword}"\n`);
  console.log(`🗑️ Removed keyword: "${keyword}" from keywords.txt`);
}

async function crawlGoogleSuggest(keyword) {
  try {
    const response = await axios.get("https://suggestqueries.google.com/complete/search", {
      params: { client: "firefox", q: keyword },
    });

    const suggestions = response.data[1];
    const newKeywords = suggestions.filter((s) => !keywords.includes(s));

    if (newKeywords.length) {
      fs.appendFileSync("keywords.txt", "\n" + newKeywords.join("\n"), "utf-8");
      keywords.push(...newKeywords);
      console.log(`➕ Added ${newKeywords.length} new keyword(s) from Google Suggest!`);
    }
  } catch (err) {
    console.log("⚠️ Error Crawl Suggest:", err.message);
  }
}

async function fakeScroll(page) {
  const steps = randomDelay(5, 10);
  for (let i = 0; i < steps; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight / 2));
    await delay(randomDelay(500, 1500));
  }
}

async function fakeMouseMove(page) {
  const box = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  for (let i = 0; i < randomDelay(20, 40); i++) {
    const x = Math.floor(Math.random() * box.width);
    const y = Math.floor(Math.random() * box.height);
    await page.mouse.move(x, y, { steps: 5 });
    await delay(randomDelay(200, 500));
  }
}

async function viewLink(page, link) {
  console.log(`→ Visiting: ${link}`);
  await page.goto(link, { waitUntil: "domcontentloaded" });
  await delay(2000);
  await fakeScroll(page);
  await fakeMouseMove(page);
  await delay(3000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await delay(2000);
  console.log("🏁 Done viewing link.");
}

(async () => {
  let count = 0;

  while ((config.loop || count < config.limit) && keywords.length > 0) {
    console.clear();
    const keyword = keywords[Math.floor(Math.random() * keywords.length)];
    console.log("============================");
    console.log(`[${++count}] 🔍 Search: "${keyword}"`);
    console.log(`📌 Remaining keywords: ${keywords.length}`);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setUserAgent(randomUseragent.getRandom());
      await page.setExtraHTTPHeaders({
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8",
      });

      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      });

      await page.goto("https://www.google.com", { timeout: 20000 });

      if (page.url().includes("/sorry/")) {
        console.log("🚫 Google Blocked → Close browser!");
        await browser.close();
        continue;
      }

      await page.type('input[name="q"]', keyword, { delay: 50 });
      await page.keyboard.press("Enter");
      await delay(3000);

      if (page.url().includes("/sorry/")) {
        console.log("🚫 Google Blocked after Search → Close browser!");
        await browser.close();
        continue;
      }

      try {
        await page.waitForSelector('a[href^="/url?"]', { timeout: 15000 });
      } catch {
        console.log("❌ No search result → Remove keyword & Close browser!");
        removeKeyword(keyword);
        await browser.close();
        continue;
      }

      // ✅ FIX: Lấy link thực từ Google redirect (q=...)
      const links = await page.$$eval('a[href^="/url?"]', (as) =>
        as.map((a) => {
          try {
            const url = new URL(a.href);
            return decodeURIComponent(url.searchParams.get("q") || "");
          } catch {
            return "";
          }
        })
      );

      const foundLinks = links.filter((link) => link.includes(domainVIP));

      if (foundLinks.length > 0) {
        console.log(`✔️ Found ${foundLinks.length} VIP link(s)!`);
        writeLog(`✅ Keyword: "${keyword}" - Found ${foundLinks.length} link(s)`);
        await crawlGoogleSuggest(keyword);

        for (const link of foundLinks) {
          await viewLink(page, link);
        }
      } else {
        console.log("❌ No VIP link found → Remove keyword & Close browser!");
        removeKeyword(keyword);
      }

    } catch (err) {
      console.log("⚠️ Error:", err.message);
    }

    await browser.close();

    const waitTime = randomDelay(config.delayMin, config.delayMax);
    console.log(`⏳ Waiting ${(waitTime / 1000).toFixed(1)}s for next run...`);
    await delay(waitTime);
  }

  console.log("🎉 Finished or No keywords left!");
})();
