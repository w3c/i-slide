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
      for (let path of shadowTreePaths) {
        if (path === ".width") {
          res[".width"] = Math.floor(el.shadowRoot.querySelector("body").getBoundingClientRect().width);
        } else {
          const [child, attr] = path.split(".");
          res[path] = attr ? el.shadowRoot.querySelector(child)?.getAttribute(attr) : !!el.shadowRoot.querySelector(child);
        }
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

const islideLoader = `
<!DOCTYPE html>
<html>
  <script src="${rootUrl}/i-slide.js" type="module" defer></script>
  <body>`;

const tests = [
  {title: "loads a single shower slide",
   slides: [ { url: "shower.html#1" } ],
   expects: [ // for each i-slide component in the page
     [ // a series of expectations
       {
         path: "img.src", // the Shadow DOM "path" being evaluated
         result: rootUrl + "/node_modules/@shower/shower/pictures/cover.jpg"
       },
       {
         path: ".width", // FIXME: not an actual DOM path
         result: 300
       }
     ]
   ]
  },
  {title:"loads multiple shower slides",
   slides: [ { url: "shower.html#1" }, { url: "shower.html#2", width: 500 }, { url: "shower.html#4" }, { url: "shower.html#25" } ],
   expects: [
     [
       {
         path: "img.src",
         result: rootUrl + "/node_modules/@shower/shower/pictures/cover.jpg"
       },
       {
         path: ".width",
         result: 300
       }
     ],
     [
       {
         path: "ol",
         result: true
       },
       {
         path: ".width",
         result: 500
       }
     ],
     [
       {
         path: "p",
         result: true
       },
       {
         path: ".width",
         result: 300
       }
     ],
     [
       {
         path: "a.href",
         result: baseUrl + "shower.html#25"
       }
     ]
   ]
  },
  {title: "loads a single b6+ slide",
   slides: [ { url: "https://www.w3.org/Talks/Tools/b6plus/#3" } ],
   expects: [
     [
       {
         path: "a.href",
          result: "https://www.w3.org/Talks/Tools/b6plus/simple.css"
       },
       {
         path: ".width",
          result: 300
       }
     ]
   ]
  },
  {title: "loads a single PDF slide",
   slides: [ { url: "slides.pdf#page=1"} ],
   expects: [
     [
       {
         path: "canvas.width",
         result: 300
       },
       {
         path: "a.href",
         result: "https://github.com/tidoust/i-slide/"
       }
     ]
   ]
  },
  {title: "loads multiple PDF slides",
   slides: [ { url: "slides.pdf#page=1"}, { url: "slides.pdf#2"}, { url: "slides.pdf#foo"}, { url: "slides.pdf#45"} ],
   expects: [
     [
       {
         path: "canvas.width",
         result: 300
       },
       {
         path: "a.href",
         result: "https://github.com/tidoust/i-slide/"
       }
     ],
     [
       {
         path: "canvas.width",
         result: 300
       }
     ],
     [
       {
         path: "a.href",
         result: baseUrl + "slides.pdf#foo"
       }
     ],
     [
       {
         path: "a.href",
         result: baseUrl + "slides.pdf#45"
       }
     ]
   ]
  },
  {title: "fallbacks to a link on CORS error",
   slides: [ {url: "about:blank#1"} ],
   expects: [
     [
       {
         path: "a.href",
         result: "about:blank#1"
       }
     ]
   ]
  },
  {title: "fallback to a link on fetch errors",
   slides: [ {url: "about:blank#1"}, { url: "about:blank#1", innerHTML: "<span>Fallback</span>"}, {url: "404.html" } ],
   expects: [
     [
       {
         path: "a.href",
         result: "about:blank#1"
       }
     ],
     [
       {
         path: "span",
         result: true
       }
     ],
     [
       {
         path: "a.href",
         result: baseUrl + "404.html"
       }
     ]
   ]
  }
];

describe("Test loading slides", function() {
  this.slow(20000);
  this.timeout(20000);
  before(async () => {
    server.listen(port);
    browser = await puppeteer.launch({ headless: !debug });
  });

  tests.forEach(t => {
    it(t.title, async() => {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      const injectContent = async req => {
        const html = t.slides.map(s => `<i-slide src="${new URL(s.url, baseUrl).href}" ${s.width ? `width=${s.width}`: ""}}>${s.innerHTML ?? ""}</i-slide>`).join("\n");
        req.respond({
          body: islideLoader + html
        });
        await page.setRequestInterception(false);
      };
      page.once('request', injectContent);
      page.on("console", msg => console.log(msg));
      await page.goto(rootUrl);
      for (let i = 0 ; i < t.expects.length; i++) {
        const paths = t.expects[i].map(e => e.path);
        const res = await evalComponent(page, paths, i);
        for (let e of t.expects[i]) {
          assert.equal(res[e.path], e.result);
        }
      }
    });
  });


  after(async () => {
    if (!debug) {
      await browser.close();
    }
    server.close();
  });
});

