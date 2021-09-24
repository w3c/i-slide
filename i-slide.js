/**
 * i-slide: Web component to display inline slides
 */


const defaultAspectRatio = 16/9;
const defaultWidth = 300;

/**
 * Local cache for holding fetched and parsed slide decks
 */
const cache = {};



/**
 * List of pending fetches for the cache to avoid re-entrancy issues
 */
const pendingFetch = {};

/**
 * List of pending dimensions calculations for the cache to avoid re-entrancy issues
 */
const pendingDimensions = {};

/**
 * PDF libraries
 * 
 * TODO: Manage version number separately (and integrate CSS stylesheet)
 */
const PDFScripts = {
  'pdfjsLib': {
    url: 'https://unpkg.com/pdfjs-dist@2.9.359/build/pdf.js',
    obj: 'pdfjs-dist/build/pdf'
  },
  'pdfjsViewer': {
    url: 'https://unpkg.com/pdfjs-dist@2.9.359/web/pdf_viewer.js',
    obj: 'pdfjs-dist/web/pdf_viewer'
  }
};


/**
 * Whether PDF scripts are being or have been handled, and promise that they
 * are available.
 */
let PDFScriptsHandled = false;
let resolvePDFScriptsPromise;
const PDFScriptsLoaded = new Promise((resolve, reject) => {
  resolvePDFScriptsPromise = resolve;
});


/**
 * The i-slide Web component
 */
class ISlide extends HTMLElement {
  /**
   * A fetch-and-render cycle has been scheduled to run during next tick
   */
  #renderCyclePlanned = false;

  /**
   * ID of the current fetch-and-render cycle (increment with each cycle)
   */
  #renderCycleID = 0;

  /**
   * Promise always set, resolved when the #render function may run.
   */
  #renderPossible = Promise.resolve();


  /**
   * Reflects the "src" attribute (slide source)
   */
  #src = this.baseURI;
  get src() {
    return this.#src;
  }
  set src(value) {
    const oldValue = this.#src;
    if (value) {
      try {
        this.#src = new URL(value, this.baseURI).href;
      }
      catch {
        value = '';
        this.#src = this.baseURI;
      }
    }
    else {
      this.#src = this.baseURI;
    }

    // Propagate the value to the HTML if change came from JS
    if (this.getAttribute('src') !== value) {
      this.setAttribute('src', value);
    }

    // Trigger a fetch-and-render cycle on next tick if value changed, unless
    // that's already planned
    if ((this.#src !== oldValue) && !this.#renderCyclePlanned) {
      this.#renderCyclePlanned = true;
      setTimeout(_ => this.#fetchAndRender(), 0);
    }
  }


  /**
   * Reflects the "width" attribute (width of the custom element)
   */
  #width = defaultWidth;
  get width() {
    return this.#width;
  }
  set width(value) {
    value = '' + value;
    const oldValue = this.#width;
    try {
      this.#width = parseInt(value, 10);
    }
    catch {
      value = '';
      this.#width = defaultWidth;
    }

    // Propagate the value to the HTML if change came from JS
    if (this.getAttribute('width') !== value) {
      this.setAttribute('width', value);
    }

    // Changing the width triggers a render to rescale the content, unless
    // a render is already planned, or unless a fetch is needed (in other words
    // unless no fetch-and-render cycle has started yet)
    if ((this.#width !== oldValue) && !this.#renderCyclePlanned &&
        (this.#renderCycleID > 0)) {
      this.#render();
    }
  }


  /**
   * Reflects the "type" attribute (explicit content-type of the slide)
   */
  #type;
  get type() {
    return this.#type;
  }
  set type(value) {
    const oldValue = this.#type;
    this.#type = value;

    // Propagate the value to the HTML if change came from JS
    if (this.getAttribute('type') !== value) {
      this.setAttribute('type', value);
    }

    // Start loading PDF scripts if needed
    if (this.#type === 'application/pdf') {
      this.#loadPDFScripts();
    }

    // Trigger a fetch-and-render cycle on next tick if value changed, unless
    // that's already planned
    if ((this.#type !== oldValue) && !this.#renderCyclePlanned) {
      this.#renderCyclePlanned = true;
      setTimeout(_ => this.#fetchAndRender(), 0);
    }
  }

  loaded;

  /**
   * Observe changes on "src" and "width" attributes.
   */
  static get observedAttributes() { return ['src', 'width', 'type']; }


  /**
   * Construct the object.
   * 
   * The constructor creates the shadow root. When the constructor gets called,
   * attributes may not be set yet, so no need to try and render something at
   * this stage. The "attributedChangedCallback" function will get called
   * automatically when attributes get parsed.
   */
  constructor() {
    super();
    this.loaded = false;
    this.attachShadow({ mode: 'open' });
  }


  /**
   * Run a new fetch-and-render cycle
   */
  async #fetchAndRender() {
    const cycleId = ++this.#renderCycleID;

    // Cycle is no longer pending, we're handling it
    this.#renderCyclePlanned = false;

    // Tell assistive technology that we're starting a cycle that will update
    // the contents of the shadow tree
    this.setAttribute('aria-busy', true);

    // Load slides
    await this.#fetch();

    if (this.#renderCyclePlanned || (this.#renderCycleID !== cycleId)) {
      // Meanwhile, in Veracruz, someone changed an attribute, and change means
      // that another full fetch-and-render cycle needs to run, or that a cycle
      // has already started to run. No need to finish this cycle.
      return;
    }

    // Render the requested slide
    await this.#render();

    if (this.#renderCyclePlanned || (this.#renderCycleID !== cycleId)) {
      // Meanwhile, in Veracruz, see above. We should neither reset the
      // "wai-aria" attribute nor trigger the "load" event since another cycle
      // is running or will run.
      return;
    }

    // Done with fetch-and-render cycle and no further cycle needed, tell the
    // world about it.
    this.setAttribute('aria-busy', false);
    this.loaded = true;
    this.dispatchEvent(new Event('load'));
  }


  /**
   * Retrieve the slide deck at the given src URL and populate the cache.
   */
  async #fetch() {
    const docUrl = this.#src.split('#')[0];

    // Retrieve slide deck from cache when possible
    if (pendingFetch[docUrl]) {
      await pendingFetch[docUrl];
    }
    if (cache[docUrl]) {
      return;
    }

    // Mark the slide deck as pending to avoid re-entrancy issues when function
    // gets called from another instance, and fetch the slide deck
    let pendingResolve;
    pendingFetch[docUrl] = new Promise(resolve => {
      pendingResolve = resolve;
    });

    try {
      const resp = await fetch(docUrl);
      if (resp.status !== 200) {
        cache[docUrl] = {
          type: 'error',
          message: `Could not fetch slide deck ${docUrl} - HTTP status code received is ${resp.status}`
        };
        return;
      }
      const contentType = resp.headers.get('Content-Type');
      // TODO: is something more robust à la https://github.com/jsdom/whatwg-mimetype needed here?
      const effectiveMimeType = contentType.split(';')[0];
      if (effectiveMimeType === 'application/pdf' ||
          // taking into account poorly configured servers
          (effectiveMimeType === 'application/octet' && docUrl.match(/\.pdf$/))) {
        this.#loadPDFScripts();
      }

      const isPDF = (this.type === 'application/pdf') || (effectiveMimeType === 'application/pdf');

      if (isPDF) {
        await PDFScriptsLoaded;
        const loadingTask = window[PDFScripts.pdfjsLib.obj].getDocument(docUrl);
        const pdf = await loadingTask.promise;
        cache[docUrl] = { type: 'pdf', pdf };
      }
      else {
        const html = await resp.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Resolve all relative links in the document
        // TODO: handle srcset for images, consider object[data]
        // TODO: handle relative URLs in inline styles
        const selector = ['src', 'href', 'poster', 'longdesc']
          .map(attr => `*[${attr}]:not([${attr}*=":"])`)
          .join(',');
        doc.querySelectorAll(selector).forEach(el => {
          const attr = el.hasAttribute('src') ? 'src' : 'href';
          const relativeUrl = el.getAttribute(attr);
          try {
            const absoluteUrl = new URL(relativeUrl, docUrl).href;
            el.setAttribute(attr, absoluteUrl);
          }
          catch {}
        });

        // TODO: Find out why fonts aren't downloaded!
        cache[docUrl] = { type: 'shower-2014', doc };
      }
    }
    catch (err) {
      cache[docUrl] = { type: 'error', message: `Could not fetch slide deck ${docUrl}: ${err.message}`, err };
    }
    finally {
      pendingResolve();
      delete pendingFetch[docUrl];
    }
  }

  // We need the slide to be rendered with its styles
  // to measure its pixel dimensions
  // We do that only once per slideset to minimize flash of resizing
  async #calculateHTMLDimensions(slideEl, stylesLoaded) {
    const docUrl = this.#src.split('#')[0];
    const cacheEntry = cache[docUrl];

    // Retrieve slide deck's width from cache when possible
    if (pendingDimensions[docUrl]) {
      await pendingDimensions[docUrl];
    }
    if (cacheEntry.width) {
      return;
    }

    let pendingResolve;
    // Mark the dimensions as pending to avoid re-entrancy issues
    pendingDimensions[docUrl] = new Promise(res => pendingResolve = res);

    await stylesLoaded;
    cacheEntry.width = slideEl.clientWidth;
    cacheEntry.height = slideEl.clientHeight;
    delete pendingDimensions[docUrl];
    pendingResolve();
  }


  /**
   * Render the requested slide
   */
  async #render() {
    // Wait until render is possible again
    await this.#renderPossible;

    // Make sure that no other render operation can run at the same time
    let resolve;
    this.#renderPossible = new Promise(res => resolve = res);

    this.shadowRoot.replaceChildren();

    const [docUrl, slideId] = this.#src.split('#');
    const cacheEntry = cache[docUrl];

    const width = this.#width;

    // Retrieve styles to be applied to the custom element to create something
    // as close as possible to a "replaced element" in CSS:
    // - custom element is an inline-block element
    // - width and height are that of the inner contents
    // - also, "hidden" attribute needs to be accounted for explicitly
    function getHostStyles(height) {
      const heightProp = height ? `
        height: ${height}px;
      ` : '';

      return `
        :host {
          display: inline-block;
          width: ${width}px;
          ${heightProp}
        }
        :host([hidden]) {
          display: none;
        }
      `;
    }

    // Styles for the custom element itself
    const hostStyleEl = document.createElement('style');
    hostStyleEl.textContent = getHostStyles();

    try {
      if (cacheEntry.type === 'error') {
        throw new Error(cacheEntry.message);
      }

      if (cacheEntry.type === 'pdf') {
        const pdfjsViewer = window[PDFScripts.pdfjsViewer.obj]
        const eventBus = new pdfjsViewer.EventBus();
        const m = slideId.match(/^(page=)?(\d+)$/);
        if (!m) throw new Error(`Unrecognized PDF fragment ${slideId}`);
        const pageNumber = parseInt(m[2], 10);
        const pdf = cacheEntry.pdf;
        const page = await pdf.getPage(pageNumber);

        const styleEl = document.createElement('link');
        styleEl.rel = 'stylesheet';
        styleEl.href = 'https://unpkg.com/pdfjs-dist@2.9.359/web/pdf_viewer.css';

        const divEl = document.createElement('div');
        // Needed to properly position the annotation layer (e.g. links)
        divEl.style.position = "relative";
        divEl.style.overflow = "hidden";

        // Make slides fit the defined width of the component
        // (Note the need to convert from
        // CSS points to CSS pixels for page dimensions)
        const scale = (width / page.view[2]) * 72/96;
        const viewport = page.getViewport({ scale });
        var pdfPageView = new pdfjsViewer.PDFPageView({
          container: divEl,
          id: pageNumber,
          scale: scale,
          defaultViewport: viewport,
          eventBus: eventBus,
          textLayerFactory: new pdfjsViewer.DefaultTextLayerFactory(),
          annotationLayerFactory: new pdfjsViewer.DefaultAnnotationLayerFactory()
        });
        // Associates the actual page with the view, and drawing it
        pdfPageView.setPdfPage(page);

        this.shadowRoot.append(hostStyleEl, styleEl, divEl);

        return pdfPageView.draw();
      }
      else {
        const { type, doc } = cache[docUrl];
        const headEl = doc.querySelector('head').cloneNode(true);
        const bodyEl = doc.querySelector('body').cloneNode();
        const slideNumber = parseInt(slideId, 10);
        const origSlideEl = doc.querySelectorAll('.slide')[slideNumber - 1];
        if (!origSlideEl) throw new Error(`Could not find slide ${slideNumber} in ${docUrl}`);
        const slideEl = origSlideEl.cloneNode(true) ;
        slideEl.style.marginLeft = '0';
        bodyEl.style.top = 'inherit';
        bodyEl.style.left = 'inherit';
        bodyEl.style.margin = 'inherit';

        //  Works for Shower and b6
        slideEl.classList.add('active');
        bodyEl.classList.add('full');
        bodyEl.classList.remove('list');

        // Specific to Shower with CSS Variables
        slideEl.style.setProperty('--slide-scale', 1);

        bodyEl.appendChild(slideEl);

        const styleLoadedPromises = [];
        [...headEl.querySelectorAll("link[rel~=stylesheet]")].map(l => {
          let resolve;
          const p = new Promise((res) => resolve = res);
          l.addEventListener("load", resolve);
          l.addEventListener("error", resolve);
          styleLoadedPromises.push(p);
        });

        // before we can properly resize the slide, we start with defined width
        // and apply the default aspect ratio to get the height
        let height = width / defaultAspectRatio;

        // Attach HTML document to shadow root, making sure that the content
        // cannot overflow the <i-slide> element (the height of the <html>
        // element must be specified because <body> is absoluted positioned in
        // Shower.js, so height of <html> would be 0 otherwise)
        const htmlEl = document.createElement('html');
        htmlEl.style.position = 'relative';
        htmlEl.style.overflow = 'hidden';
        htmlEl.style.height = `${height}px`;

        bodyEl.style.transformOrigin = '0 0';
        // Set the custom element's height
        // (cannot let CSS compute the height because slides are absolutely
        // positioned most of the time...)
        hostStyleEl.textContent = getHostStyles(height);
        headEl.appendChild(hostStyleEl);

        htmlEl.appendChild(headEl);
        htmlEl.appendChild(bodyEl);

        function scaleContent() {
          const scale = width / cacheEntry.width;
          height = cacheEntry.height * scale;
          htmlEl.style.height = `${height}px`;
          hostStyleEl.textContent = getHostStyles(height);
          bodyEl.style.transform = `scale(${scale})`;
        }

        if (cacheEntry.width) {
          scaleContent();
          this.shadowRoot.append(htmlEl);
        } else {
          // we hide the slide on the left
          // to avoid showing bogusly scaled content
          slideEl.style.marginLeft = "-2000px";
          this.shadowRoot.append(htmlEl);
          // Once we know the real dimensions of the slide…
          await this.#calculateHTMLDimensions(slideEl, Promise.all(styleLoadedPromises));
          // we can rescale it as appropriate
          scaleContent();
          // and move it back in the flow
          slideEl.style.marginLeft = "inherit";
        }


      }
    } catch (err) {
      console.error(err.toString(), err);
      this.shadowRoot.innerHTML = "";
      const doc = document.createElement('div');
      doc.innerHTML = this.innerHTML.trim() || `<a href="${this.src}">${this.src}</a>`;
      this.shadowRoot.append(hostStyleEl, doc);
    }
    finally {
      // Release the #renderPossible lock
      resolve();
    }
  }


  /**
   * Listen to attribute changes and render slide appropriately.
   * 
   * Calling the property setters may may trigger asynchronous steps such as
   * network I/O to fetch the slides.
   *
   * Note the function gets called when attributes are initialized.
   */
  attributeChangedCallback(name, oldValue, newValue) {
    switch (name) {
      case 'src':
        this.src = newValue;
        break;
      case 'type':
        this.type = newValue;
        break;
      case 'width':
        this.width = newValue;
        break;
    }
  }


  /**
   * Load PDF.js libraries
   */
  async #loadPDFScripts() {
    if (PDFScriptsHandled) {
      return;
    }
    PDFScriptsHandled = true;

    for (const { url, obj } of Object.values(PDFScripts)) {
      if (window[obj]) {
        continue;
      }

      const scriptEl = document.createElement('script');
      scriptEl.src = url;

      let resolvePromise;
      let rejectPromise;
      const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
      scriptEl.addEventListener('load', resolvePromise);
      scriptEl.addEventListener('error', rejectPromise)
      document.body.appendChild(scriptEl);

      await promise;
    }

    // TODO: move hard-coded URL elsewhere
    window[PDFScripts.pdfjsLib.obj].GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@2.9.359/build/pdf.worker.js';

    resolvePDFScriptsPromise();
  }
}

// Register the custom element
customElements.define('i-slide', ISlide);

export default ISlide;
