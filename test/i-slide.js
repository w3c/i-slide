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

const islideLoader = `
<!DOCTYPE html>
<html>
  <script src="${rootUrl}/i-slide.js" type="module" defer></script>
  <body>`;


/**
 * List of declarative tests, defined as an object whose keys are test titles,
 * and whose values describe a slide set. The slide set needs to be an array of
 * slide objects. The array level may be omitted if the slideset contains only
 * one slide.
 *
 * A slide object must contain the following properties:
 * - "slide": either a string interpreted as the slide URL or an object with a
 *   "url" property, and possibly a "width" property and/or "innerHTML" property
 * - "expects": A list of expectations (an array), or a single expectation (an
 *   object).
 *
 * An expectation is an object with:
 * - a "path" property that is a CSS selector to the element to evaluate,
 * starting from the shadow root of the <i-slide> element, with the following
 * extensions to CSS selectors:
 *   1. if the string ends with "@name", the value of the attribute "name" on
 *   the matched element is evaluated. For instance: "div>a@href" evaluates the
 *   "href" attribute of the "div>a" element.
 *   2. the string ".width" evaluates to the width of the "body" element of the
 *   shadow root (TODO: find a better way to express this)
 * - a mandatory "result" property that gives the expected result of the
 * evaluation. For attributes, this is the expected value. For elements, this
 * needs to be a boolean (true when element is expected, false otherwise). The
 * "eval" property can be used to change this meaning.
 * - an "eval" property that can be used to provide a specific evaluation
 * function. The evaluation function gets evaluated in the context of the loaded
 * page. It must return a serializable object. The "eval" function gets called
 * without argument, but note "window.slideEl" is set to the current <i-slide>
 * element when that function is called. The "path" property has no meaning when
 * "eval" is set.
 */
const tests = {
  "loads a single shower slide": {
    slide: "shower.html#1",
    expects: [
      { path: "img@src", result: rootUrl + "/node_modules/@shower/shower/pictures/cover.jpg" },
      { path: ".width", result: 300 }
    ]
  },

  "loads multiple shower slides": [
    {
      slide: "shower.html#1",
      expects: [
        { path: "img@src", result: rootUrl + "/node_modules/@shower/shower/pictures/cover.jpg" },
        { path: ".width", result: 300 }
      ]
    },
    {
      slide: { url: "shower.html#2", width: 500 },
      expects: [
        { path: "ol", result: true },
        { path: ".width", result: 500 }
      ]
    },
    {
      slide: "shower.html#4",
      expects: [
        { path: "p", result: true },
        { path: ".width", result: 300 }
      ]
    },
    {
      slide: "shower.html#25",
      expects: [
        { path: "a@href", result: baseUrl + "shower.html#25" }
      ]
    }
  ],

  "loads a single b6+ slide": {
    slide: "https://www.w3.org/Talks/Tools/b6plus/#3",
    expects: [
      { path: "a@href", result: "https://www.w3.org/Talks/Tools/b6plus/simple.css" },
      { path: ".width", result: 300 }
    ]
  },

  "loads a single PDF slide": {
    slide: "slides.pdf#page=1",
    expects: [
      { path: "canvas@width", result: 300 },
      { path: "a@href", result: "https://github.com/tidoust/i-slide/" }
    ]
  },

  "loads multiple PDF slides": [
    {
      slide: "slides.pdf#page=1",
      expects: [
        { path: "canvas@width", result: 300 },
        { path: "a@href", result: "https://github.com/tidoust/i-slide/" }
      ]
    },
    {
      slide: "slides.pdf#2",
      expects: { path: "canvas@width", result: 300 }
    },
    {
      slide: "slides.pdf#foo",
      expects: { path: "a@href", result: baseUrl + "slides.pdf#foo" }
    },
    {
      slide: "slides.pdf#45",
      expects: { path: "a@href", result: baseUrl + "slides.pdf#45" }
    }
  ],

  "fallbacks to a link on CORS error": {
    slide: "about:blank#1",
    expects: { path: "a@href", result: "about:blank#1" }
  },

  "fallbacks to a link on fetch errors": [
    {
      slide: "about:blank#1",
      expects: { path: "a@href", result: "about:blank#1" }
    },
    {
      slide: { url: "about:blank#1", innerHTML: "<span>Fallback</span>"},
      expects: { path: "span", result: true }
    },
    {
      slide: "404.html",
      expects: { path: "a@href", result: baseUrl + "404.html" }
    }
  ],

  "renders as a block element for HTML slides": {
    slide: "shower.html#1",
    expects: {
      eval: el => window.getComputedStyle(window.slideEl).display,
      result: "block"
    }
  },

  "renders as a block element for PDF slides": {
    slide: "slides.pdf#1",
    expects: {
      eval: el => window.getComputedStyle(window.slideEl).display,
      result: "block"
    }
  },

  "sets the styles of the root element properly for HTML slides": {
    slide: "shower.html#1",
    expects: {
      eval: el => {
        const rootEl = window.slideEl.shadowRoot.querySelector("html");
        const styles = window.getComputedStyle(rootEl);
        return `${styles.position}|${styles.overflow}|${styles.height}`;
      },
      result: `relative|hidden|${300/(16/9)}px`
    }
  },

  "sets the styles of the root element properly for PDF slides": {
    slide: "slides.pdf#1",
    expects: {
      eval: el => {
        const rootEl = window.slideEl.shadowRoot.querySelector("div");
        const styles = window.getComputedStyle(rootEl);
        return `${styles.position}|${styles.overflow}`;
      },
      result: "relative|hidden"
    }
  }
};


async function evalComponent(page, expectations, slideNumber = 0) {
  try {
    // Set current <i-slide> el and wait for page to be fully loaded
    await page.evaluate(async (slideNumber) => {
      const el = document.querySelectorAll("i-slide")[slideNumber];
      if (!el) {
        throw new Error("cannot find Web Component");
      }
      window.slideEl = el;
      if (el.loaded) {
        return;
      }

      let resolve;
      const p = new Promise((res, rej) => {
        resolve = res;
      });
      el.addEventListener("load", () => {
        resolve();
      });
      return p;
    }, slideNumber);

    // Evaluate expectations one by one (needed to be able to run custom
    // evaluation functions)
    return Promise.all(expectations.map(async (expect, k) => {
      if (expect.eval) {
        return page.evaluate(expect.eval);
      }
      else {
        return page.evaluate(async (path) => {
          const el = window.slideEl;
          if (path === ".width") {
            return Math.floor(el.shadowRoot.querySelector("body").getBoundingClientRect().width);
          }
          else {
            const [selector, attr] = (path || "").split("@");
            const child = selector ? el.shadowRoot.querySelector(selector) : el;
            return attr ? child?.getAttribute(attr) : !!child;
          }
        }, expect.path);
      }
    }));
  }
  catch (err) {
    return {error: err.toString()};
  }
}


describe("Test loading slides", function() {
  this.slow(20000);
  this.timeout(20000);
  before(async () => {
    server.listen(port);
    browser = await puppeteer.launch({ headless: !debug });
  });

  for (let [title, slideset] of Object.entries(tests)) {
    //if (title !== "renders as a block element in HTML slides") continue;
    slideset = Array.isArray(slideset) ? slideset : [slideset];

    it(title, async () => {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      const injectContent = async req => {
        const html = slideset.map(s => {
          const slide = (typeof s.slide === "string") ? { url: s.slide } : s.slide;
          return `<i-slide
            src="${new URL(slide.url, baseUrl).href}"
            ${slide.width ? `width=${slide.width}`: ""}}>
              ${slide.innerHTML ?? ""}
            </i-slide>`;
        }).join("\n");
        req.respond({
          body: islideLoader + html
        });
        await page.setRequestInterception(false);
      };
      page.once('request', injectContent);
      page.on("console", msg => console.log(msg.text()));
      await page.goto(rootUrl);
      for (let i = 0; i < slideset.length; i++) {
        const expects = Array.isArray(slideset[i].expects) ?
          slideset[i].expects : [slideset[i].expects];
        const res = await evalComponent(page, expects, i);
        for (let k = 0; k < expects.length; k++) {
          assert.equal(res[k], expects[k].result);
        }
      }
    });
  }

  after(async () => {
    if (!debug) {
      await browser.close();
    }
    server.close();
  });
});

