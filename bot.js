const puppeteer = require("puppeteer-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
const randomUseragent = require("random-useragent");
const axios = require("axios");
const fs = require("fs");
const config = require("./config");

puppeteer.use(stealth);

const domain = "meostore.netlify.app";
const logFile = "log.txt";
const internalPaths = ["/", "/napgame.html", "/lichsu.html", "/api.html", "/gioithieu.html"];

// Auto create files
["keywords.txt", logFile, "removed.txt"].forEach(file => {
  if (!fs.existsSync(file)) fs.writeFileSync(file, "");
});

let keywords = fs.readFileSync("keywords.txt", "utf-8")
  .split("\n")
  .map(k => k.trim())
  .filter(Boolean);

const delay = ms => new Promise(res => setTimeout(res, ms));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min) + min);

function writeLog(msg) {
  const time = new Date().toLocaleString("vi-VN");
  fs.appendFileSync(logFile, `[${time}] ${msg}\n`);
}

function removeKeyword(keyword) {
  keywords = keywords.filter(k => k !== keyword);
  fs.writeFileSync("keywords.txt", keywords.join("\n"));
  fs.appendFileSync("removed.txt", `[${new Date().toLocaleString("vi-VN")}] Removed: "${keyword}"\n`);
}

async function crawlGoogleSuggest(keyword) {
  try {
    const res = await axios.get("https://suggestqueries.google.com/complete/search", {
      params: { client: "firefox", q: keyword },
    });
    const suggestions = res.data[1];
    const newKeywords = suggestions.filter(s => !keywords.includes(s));
    if (newKeywords.length) {
      fs.appendFileSync("keywords.txt", "\n" + newKeywords.join("\n"));
      keywords.push(...newKeywords);
      console.log(`➕ Added ${newKeywords.length} new keywords.`);
    }
  } catch (err) {
    console.log("⚠️ Error fetching suggestions:", err.message);
  }
}

async function simulateUserInteraction(page) {
  const scrollSteps = randomDelay(4, 8);
  for (let i = 0; i < scrollSteps; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight / 1.5));
    await delay(randomDelay(500, 1000));
  }

  const { width, height } = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  for (let i = 0; i < randomDelay(10, 20); i++) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    await page.mouse.move(x, y, { steps: 5 });
    await delay(randomDelay(300, 600));
  }

  await delay(randomDelay(3000, 6000));
}

async function visitInternalLinks(page) {
  const paths = internalPaths.sort(() => 0.5 - Math.random()).slice(0, 2);
  for (const path of paths) {
    const url = `https://${domain}${path}`;
    console.log(`↪️ Visiting: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", referer: "https://www.google.com" });
    await simulateUserInteraction(page);
  }
}

(async () => {
  let count = 0;

  while ((config.loop || count < config.limit) && keywords.length > 0) {
    console.clear();
    const keyword = keywords[Math.floor(Math.random() * keywords.length)];
    console.log(`[${++count}] 🔍 Searching: "${keyword}"`);
    console.log(`📌 Remaining keywords: ${keywords.length}`);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setUserAgent(randomUseragent.getRandom());
      await page.setExtraHTTPHeaders({
        "Accept-Language": "vi-VN,vi;q=0.9",
        "Referer": "https://www.google.com"
      });

      await page.goto("https://www.google.com", { timeout: 20000 });
      await page.type('input[name="q"]', keyword, { delay: 100 });
      await page.keyboard.press("Enter");
      await delay(3000);

      const links = await page.$$eval("a[href^='/url?']", as =>
        as.map(a => decodeURIComponent(new URL(a.href).searchParams.get("q") || ""))
      );

      const matchedLinks = links.filter(link => link.includes(domain));
      if (matchedLinks.length > 0) {
        console.log(`✔️ Found ${matchedLinks.length} link(s) to site`);
        writeLog(`Keyword: "${keyword}" → ${matchedLinks.length} links`);
        await crawlGoogleSuggest(keyword);

        const target = matchedLinks[0];
        await page.goto(target, { waitUntil: "domcontentloaded", referer: "https://www.google.com" });
        await simulateUserInteraction(page);
        await visitInternalLinks(page);
      } else {
        console.log("❌ No link found → Remove keyword");
        removeKeyword(keyword);
      }

    } catch (err) {
      console.log("⚠️ Error:", err.message);
    }

    await browser.close();
    const waitTime = randomDelay(config.delayMin, config.delayMax);
    console.log(`⏳ Waiting ${(waitTime / 1000).toFixed(1)}s...`);
    await delay(waitTime);
  }

  console.log("🎉 Done or no keywords left.");
})();
