const assert = require('assert');
const puppeteer = require('puppeteer');

const {HttpServer} = require("http-server");

const server = new HttpServer({
  cors: true,
  port: 0,
  logFn: (req, res, err) => {
    // Ignore "not found" errors that some tests generate on purpose
    if (err && err.status !== 404) {
      console.error(err, req.url, req.status);
    }
  }
});

let browser;
const port = process.env.PORT ?? 8081;
const rootUrl = `http://localhost:${port}`;
const baseUrl = `${rootUrl}/test/resources/`;
const debug = !!process.env.DEBUG;

async function evalComponent(page, shadowTreePaths, slideNumber = 0) {
  return page.evaluate(async (shadowTreePaths, slideNumber) => {
    function extractInfo(el) {
      const res = {};
      if (el.shadowRoot.querySelector("body")) {
        const {height, width} = el.shadowRoot.querySelector("body").getBoundingClientRect();
        res.height = Math.floor(height);
        res.width = Math.floor(width);
      }
      for ([child, attr] of shadowTreePaths) {
        res[child] = attr ? el.shadowRoot.querySelector(child)?.getAttribute(attr) : !!el.shadowRoot.querySelector(child);
      }
      return res;
    }
    const el = document.querySelectorAll("i-slide")[slideNumber];
    if (!el) {
      return {error: "cannot find Web Component"};
    }
    if (el.loaded) return extractInfo(el);
    let resolve;
    const p = new Promise((res, rej) => {
      resolve = res;
    });
    el.addEventListener("load", () => {
      resolve(extractInfo(el));
    });
    return p;
  }, shadowTreePaths, slideNumber);
}

describe("Test loading slides", function() {
  this.slow(20000);
  this.timeout(20000);
  before(async () => {
    server.listen(port);
    browser = await puppeteer.launch({ headless: !debug });
  });

  it("loads a single shower slide", async () => {
    const page = await browser.newPage();
    page.on("console", msg => console.log(msg));
    await page.goto(baseUrl + 'shower-islide.html');
    const res = await evalComponent(page, [["img", "src"]]);
    assert.equal(res.error, undefined);
    assert.equal(res.width, 300);
    assert.deepEqual(res.img, rootUrl + "/node_modules/@shower/shower/pictures/cover.jpg");
    if (!debug) await page.close();

  });

  it("loads multiple shower slides", async () => {
    const page = await browser.newPage();
    page.on("console", msg => console.log(msg));
    await page.goto(baseUrl + 'shower-multiple-islide.html');
    const res1 = await evalComponent(page, [["img", "src"]], 0);
    assert.equal(res1.error, undefined);
    assert.equal(res1.width, 300);
    assert.deepEqual(res1.img, rootUrl + "/node_modules/@shower/shower/pictures/cover.jpg");

    const res2 = await evalComponent(page, [["ol"]], 1);
    assert.equal(res2.error, undefined);
    assert.equal(res2.width, 500);
    assert(res2.ol);

    const res3 = await evalComponent(page, [["p"]], 2);
    assert.equal(res3.error, undefined);
    assert.equal(res3.width, 300);
    assert(res3.p);

    const res4 = await evalComponent(page, [["a", "href"]], 3);
    assert.equal(res4.error, undefined);
    assert.equal(res4.a, baseUrl + "shower.html#25");

    // TODO: test scale was calculated only once

    if (!debug) await page.close();

  });


  it("loads a single b6+ slide", async () => {
    const page = await browser.newPage();
    page.on("console", msg => console.log(msg));
    await page.goto(baseUrl + 'b6+-islide.html');
    const res = await evalComponent(page, [["a", "href"]]);
    assert.equal(res.error, undefined);
    assert.equal(res.width, 300);
    assert.deepEqual(res.a, "https://www.w3.org/Talks/Tools/b6plus/simple.css");
    if (!debug) await page.close();

  });


  it("loads a single PDF slide", async () => {
    const page = await browser.newPage();
    await page.goto(baseUrl + 'pdf-islide.html');
    const res = await evalComponent(page, [["canvas", "width"], ["a", "href"]]);
    assert.equal(res.error, undefined);
    assert.equal(res.canvas, 300);
    assert.equal(res.a, "https://github.com/tidoust/i-slide/");
    if (!debug) await page.close();

  });

  it("loads multiple PDF slides", async () => {
    const page = await browser.newPage();
    await page.goto(baseUrl + 'pdf-multi-islide.html');
    const res1 = await evalComponent(page, [["canvas", "width"], ["a", "href"]]);
    assert.equal(res1.error, undefined);
    assert.equal(res1.canvas, 300);
    assert.equal(res1.a, "https://github.com/tidoust/i-slide/");

    const res2 = await evalComponent(page, [["canvas", "width"]], 1);
    assert.equal(res2.error, undefined);
    assert.equal(res2.canvas, 400);

    const res3 = await evalComponent(page, [["a", "href"]], 2);
    assert.equal(res3.error, undefined);
    assert.equal(res3.a, baseUrl + "slides.pdf#foo");

    const res4 = await evalComponent(page, [["a", "href"]], 3);
    assert.equal(res4.error, undefined);
    assert.equal(res4.a, baseUrl + "slides.pdf#45");

    if (!debug) await page.close();

  });

  it("falls back to a link by default", async () => {
    const page = await browser.newPage();
    await page.goto(baseUrl + 'error-islide.html');
    const res = await evalComponent(page, [["a", "href"]]);
    assert.equal(res.error, undefined);
    assert.equal(res.a, "about:blank#1");
    if (!debug) await page.close();

  });

  it("falls back to the inner content when defined", async () => {
    const page = await browser.newPage();
    await page.goto(baseUrl + 'error-2-islide.html');
    const res = await evalComponent(page, [["span"]]);
    assert.equal(res.error, undefined);
    assert(res.span);
    if (!debug) await page.close();

  });

  it("falls back when slide set is a 404", async () => {
    const page = await browser.newPage();
    await page.goto(baseUrl + '404-islide.html');
    const res = await evalComponent(page, [["a", "href"]]);
    assert.equal(res.error, undefined);
    assert.equal(res.a, "http://localhost:8081/test/resources/404#1");
    if (!debug) await page.close();

  });

  // TO TEST
  // multiple slides, single fetch

  after(async () => {
    if (!debug) {
      await browser.close();
    }
    server.close();
  });
});

