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
    } else if (req.url.startsWith(`/test/resources/i-slide.js`)) {
      // To make the demo file usable on the root dir, we make
      // the test server resolve it
      res.redirect(req.url.replace('/test/resources', ''));
    }
  }
});

let browser;
const port = process.env.PORT ?? 8081;
const rootUrl = `http://localhost:${port}`;
const baseUrl = `${rootUrl}/test/resources/`;
const debug = !!process.env.DEBUG;
const testTitle = process.env.ISLIDETEST;

const islideLoader = `
<!DOCTYPE html>
<html>
  ${debug ? '<script type="text/javascript">const DEBUG = true;</script>' : ''}
  <script src="${rootUrl}/i-slide.js?register" type="module"></script>
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

  "finds a shower slide by its ID": {
    slide: "shower.html#cover",
    expects: {
      path: "img@src",
      result: rootUrl + "/node_modules/@shower/shower/pictures/cover.jpg"
    }
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

  "renders as an inline-block element for HTML slides": {
    slide: "shower.html#1",
    expects: {
      eval: _ => window.getComputedStyle(window.slideEl).display,
      result: "inline-block"
    }
  },

  "renders as an inline-block element for PDF slides": {
    slide: "slides.pdf#1",
    expects: {
      eval: _ => window.getComputedStyle(window.slideEl).display,
      result: "inline-block"
    }
  },

  "renders as a 300px wide element by default": {
    slide: "shower.html#1",
    expects: {
      eval: _ => window.getComputedStyle(window.slideEl).width,
      result: '300px'
    }
  },

  "sets the styles of the root element properly for HTML slides": {
    slide: "shower.html#1",
    expects: {
      eval: _ => {
        const rootEl = window.slideEl.shadowRoot.querySelector("html");
        const styles = window.getComputedStyle(rootEl);
        return `${styles.position}|${styles.overflow}|${styles.width}|${styles.height}`;
      },
      result: `relative|hidden|300px|${300/(16/9)}px`
    }
  },

  "sets the styles of the root element properly for PDF slides": {
    slide: "slides.pdf#1",
    expects: {
      eval: _ => {
        const rootEl = window.slideEl.shadowRoot.querySelector("div");
        const styles = window.getComputedStyle(rootEl);
        return `${styles.position}|${styles.overflow}|${styles.width}`;
      },
      result: "relative|hidden|300px"
    }
  },

  "sets aria-busy while loading a slide": {
    slide: "",
    expects: {
      eval: async _ => {
        const before = window.slideEl.getAttribute("aria-busy") ?? "false";
        let during;
        let resolve;

        window.slideEl.src = "test/resources/shower.html#1";
        window.slideEl.addEventListener("load", () => {
          const after = window.slideEl.getAttribute("aria-busy") ?? "false";
          resolve(`aria-busy before:${before} during:${during} after:${after}`);
        });

        // setImmediate would be preferable so as not to be clamped to 4ms and
        // miss the "aria-busy" switch, but not supported in Chromium
        window.setTimeout(() => {
          during = window.slideEl.getAttribute("aria-busy") ?? "false";
        }, 0);

        return new Promise(res => resolve = res);
      },
      result: "aria-busy before:false during:true after:false"
    }
  },

  "reflects attributes in properties": {
    slide: "shower.html#1",
    expects: {
      eval: async _ => {
        const el = window.slideEl;
        el.setAttribute("width", 400);
        el.setAttribute("height", 200);
        el.setAttribute("type", "text/html");
        el.setAttribute("src", "test/resources/shower.html#2");
        return `width:${el.width} height:${el.height} type:${el.type} src:${el.src}`;
      },
      // NB: the "src" property returns the absolute URL (as for <img> elements)
      result: `width:400 height:200 type:text/html src:${baseUrl}shower.html#2`
    }
  },

  "propagates property updates to attributes": {
    slide: "shower.html#1",
    expects: {
      eval: async _ => {
        const el = window.slideEl;
        el.width = 400;
        el.height = 200;
        el.type = "text/html";
        el.src = "test/resources/shower.html#2";
        return `width:${el.getAttribute('width')} height:${el.getAttribute('height')} type:${el.getAttribute('type')} src:${el.getAttribute('src')}`;
      },
      result: `width:400 height:200 type:text/html src:test/resources/shower.html#2`
    }
  },

  "renders as a box with the requested dimensions (HTML slide)": {
    slide: { url: "shower.html#1", width: 400, height: 400 },
    expects: {
      eval: async _ => {
        const styles = window.getComputedStyle(window.slideEl);
        return `width:${styles.width} height:${styles.height}`;
      },
      result: "width:400px height:400px"
    }
  },

  "renders as a box with the requested dimensions (PDF slide)": {
    slide: { url: "slides.pdf#1", width: 400, height: 400 },
    expects: {
      eval: async _ => {
        const styles = window.getComputedStyle(window.slideEl);
        return `width:${styles.width} height:${styles.height}`;
      },
      result: "width:400px height:400px"
    }
  },

  "scales content to fit the available width (HTML slide)": {
    slide: { url: "shower.html#1", width: 144, height: 144 },
    expects: {
      eval: async _ => {
        const rootEl = window.slideEl.shadowRoot.querySelector("html");
        const styles = window.getComputedStyle(rootEl);
        return `width:${styles.width} height:${styles.height}`;
      },
      result: `width:144px height:${144/(16/9)}px`
    }
  },

  "scales content to fit the available height (HTML slide)": {
    slide: { url: "shower.html#1", width: 600, height: 144 },
    expects: {
      eval: async _ => {
        const rootEl = window.slideEl.shadowRoot.querySelector("html");
        const styles = window.getComputedStyle(rootEl);
        return `width:${styles.width} height:${styles.height}`;
      },
      result: `width:${144*(16/9)}px height:144px`
    }
  },

  "scales content to fit the available width (PDF slide)": {
    slide: { url: "slides.pdf#1", width: 144, height: 144 },
    expects: {
      eval: async _ => {
        const rootEl = window.slideEl.shadowRoot.querySelector("canvas");
        const styles = window.getComputedStyle(rootEl);
        return `width:${styles.width} height:${styles.height}`;
      },
      result: `width:144px height:${144/(16/9)}px`
    }
  },

  "scales content to fit the available height (PDF slide)": {
    slide: { url: "slides.pdf#1", width: 600, height: 144 },
    expects: {
      eval: async _ => {
        const rootEl = window.slideEl.shadowRoot.querySelector("canvas");
        const styles = window.getComputedStyle(rootEl);
        return `width:${styles.width} height:${styles.height}`;
      },
      result: `width:${144*(16/9)}px height:144px`
    }
  },

  "scales content to fit the available width when CSS sets the box dimensions": {
    slide: { url: "shower.html#1", css: "i-slide { width: 144px }" },
    expects: {
      eval: async _ => {
        const rootEl = window.slideEl.shadowRoot.querySelector("html");
        const styles = window.getComputedStyle(rootEl);
        return `width:${styles.width} height:${styles.height}`;
      },
      result: `width:144px height:${144/(16/9)}px`
    }
  },

  "scales content to fit the available height when CSS sets the box dimensions": {
    slide: { url: "shower.html#1", css: "i-slide { height: 144px }" },
    expects: {
      eval: async _ => {
        const rootEl = window.slideEl.shadowRoot.querySelector("html");
        const styles = window.getComputedStyle(rootEl);
        return `width:${styles.width} height:${styles.height}`;
      },
      result: `width:${144*(16/9)}px height:144px`
    }
  },

  "scales content when box gets sized down (HTML slide)": {
    slide: { url: "shower.html#1" },
    expects: {
      eval: async _ => {
        window.slideEl.style.width = "144px";
        let resolve;
        const promise = new Promise(res => resolve = res);

        // Need to give code a bit of time to process the resize
        window.setTimeout(_ => {
          const rootEl = window.slideEl.shadowRoot.querySelector("html");
          const styles = window.getComputedStyle(rootEl);
          resolve(`width:${styles.width} height:${styles.height}`);
        }, 100);
        return promise;
      },
      result: `width:144px height:${144/(16/9)}px`
    }
  },

  "scales content when box gets sized down (PDF slide)": {
    slide: { url: "slides.pdf#1" },
    expects: {
      eval: async _ => {
        window.slideEl.style.height = "144px";
        let resolve;
        const promise = new Promise(res => resolve = res);

        // Need to give code a bit of time to process the resize
        window.setTimeout(_ => {
          const rootEl = window.slideEl.shadowRoot.querySelector("canvas");
          const styles = window.getComputedStyle(rootEl);
          resolve(`width:${styles.width} height:${styles.height}`);
        }, 100);
        return promise;
      },
      result: `width:${144*(16/9)}px height:144px`
    }
  },

  "renders new slide correctly when slide changes (HTML to HTML)": {
    slide: { url: "shower.html#1", width: 144 },
    expects: {
      eval: async _ => {
        let resolve;
        const promise = new Promise(res => resolve = res);

        window.slideEl.addEventListener("load", _ => {
          const rootEl = window.slideEl.shadowRoot.querySelector("html");
          const styles = window.getComputedStyle(rootEl);
          resolve(`width:${styles.width} height:${styles.height}`);
        });
        window.slideEl.src = "test/resources/shower.html#2";
        return promise;
      },
      result: `width:144px height:${144/(16/9)}px`
    }
  },

  "renders new slide correctly when slide changes (PDF to PDF)": {
    slide: { url: "slides.pdf#1", width: 144 },
    expects: {
      eval: async _ => {
        let resolve;
        const promise = new Promise(res => resolve = res);

        window.slideEl.addEventListener("load", _ => {
          const rootEl = window.slideEl.shadowRoot.querySelector("canvas");
          const styles = window.getComputedStyle(rootEl);
          resolve(`width:${styles.width} height:${styles.height}`);
        });
        window.slideEl.src = "test/resources/slides.pdf#2";
        return promise;
      },
      result: `width:144px height:${144/(16/9)}px`
    }
  },

  "renders new slide correctly when slide changes (HTML to PDF)": {
    slide: { url: "shower.html#1", height: 144 },
    expects: {
      eval: async _ => {
        let resolve;
        const promise = new Promise(res => resolve = res);

        window.slideEl.addEventListener("load", _ => {
          const rootEl = window.slideEl.shadowRoot.querySelector("canvas");
          const styles = window.getComputedStyle(rootEl);
          resolve(`width:${styles.width} height:${styles.height}`);
        });
        window.slideEl.src = "test/resources/slides.pdf#1";
        return promise;
      },
      result: `width:${144*(16/9)}px height:144px`
    }
  },

  "renders new slide correctly when slide changes (PDF to HTML)": {
    slide: { url: "slides.pdf#1", height: 144 },
    expects: {
      eval: async _ => {
        let resolve;
        const promise = new Promise(res => resolve = res);

        window.slideEl.addEventListener("load", _ => {
          const rootEl = window.slideEl.shadowRoot.querySelector("html");
          const styles = window.getComputedStyle(rootEl);
          resolve(`width:${styles.width} height:${styles.height}`);
        });
        window.slideEl.src = "test/resources/shower.html#1";
        return promise;
      },
      result: `width:${144*(16/9)}px height:144px`
    }
  }
};

const demoTestExpectations = [
  [
    { path: "ol", result: true }
  ],
  [
    { path: "a@href", result: "https://www.w3.org/Talks/Tools/b6plus/simple.css" }
  ],
  [
    { path: "canvas", result: true }
  ],
  [
    { path: "canvas", result: true }
  ]
];

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
    if (testTitle && !title.includes(testTitle)) continue;
    slideset = Array.isArray(slideset) ? slideset : [slideset];

    it(title, async () => {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      const injectContent = async req => {
        const html = slideset.map(s => {
          const slide = (typeof s.slide === "string") ? { url: s.slide } : s.slide;
          return `
            ${slide.css ? "<style>" + slide.css + "</style>" : ""}
            <i-slide src="${new URL(slide.url, baseUrl).href}"
                ${slide.width ? `width=${slide.width}`: ""}
                ${slide.height ? `height=${slide.height}`: ""}>
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

  if (!testTitle) {
    it('loads the slides on the demo page as expected', async () => {
      const page = await browser.newPage();
      await page.goto(baseUrl + 'demo.html');
      for (let i = 0; i < demoTestExpectations.length; i++) {
        const expects = demoTestExpectations[i];
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

