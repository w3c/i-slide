const assert = require('assert');
const puppeteer = require('puppeteer');

const {HttpServer} = require("http-server");

const server = new HttpServer(
  {cors: true,
   port: 0,
   logFn: (req, res, err) => { if (err) console.error(err, req.url, req.status); } 
  });

let browser;
const port = process.env.PORT ?? 8081;
const rootUrl = `http://localhost:${port}`;
const baseUrl = `${rootUrl}/test/resources/`;
const debug = !!process.env.DEBUG;

async function evalComponent(page, shadowTreePaths) {
  return page.evaluate(async (shadowTreePaths) => {
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
    const el = document.querySelector("i-slide")
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
  }, shadowTreePaths);
}

describe("Test loading a single slide", function() {
  this.slow(5000);
  this.timeout(5000);
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

  // TO TEST
  // multiple slides, single fetch
  // error loading slides

  after(async () => {
    if (!debug) {
      await browser.close();
    }
    server.close();
  });
});

