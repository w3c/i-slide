/**
 * i-slide: Web component to display inline slides
 */

/**
 * Local cache for holding fetched and parsed slide decks
 */
const cache = {};



/**
 * List of pending fetches for the cache to avoid re-entrance issues
 */
const pendingFetch = {};


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
 * Promise that 
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
   * Reflects the "src" attribute (slide source)
   */
  src;


  /**
   * Reflects the "width" attribute (width of the custom element)
   */
  width;


  /**
   * Reflects the "type" attribute (explicit content-type of the slide)
   */
  type;


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
   * Retrieve the slide deck at the given src URL and populate the cache.
   * 
   * TODO: Set aria-busy to true, reset in render
   */
  async fetch() {
    if (!this.src) {
      return;
    }

    const docUrl = this.src.split('#')[0];

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

    if (this.type === 'application/pdf') {
      this.loadPDFScripts();
    }

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
        this.loadPDFScripts();
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
      cache[docUrl] = { type: 'error', msg: `Could not fetch slide deck ${docUrl}: ${err.message}`, err };
    }
    finally {
      pendingResolve();
      delete pendingFetch[docUrl];
    }
  }


  /**
   * Render the requested slide
   */
  async render() {
    this.shadowRoot.replaceChildren();
    if (!this.src) {
      return;
    }

    const [docUrl, slideId] = this.src.split('#');
    const cacheEntry = cache[docUrl];

    const width = parseInt(this.getAttribute('width') ?? 300, 10);

    try {
      if (cacheEntry.type === 'error') {
        throw new Error(cacheEntry.msg);
      }
      if (cacheEntry.type === 'pdf') {
        const pdfjsViewer = window[PDFScripts.pdfjsViewer.obj]
        const eventBus = new pdfjsViewer.EventBus();
        // TODO: Parse "page=x" properly
        const pageNumber = parseInt(slideId.slice(5));
        const pdf = cacheEntry.pdf;
        const page = await pdf.getPage(pageNumber);

        const styleEl = document.createElement('link');
        styleEl.rel = 'stylesheet';
        styleEl.href = 'https://unpkg.com/pdfjs-dist@2.9.359/web/pdf_viewer.css';

        const divEl = document.createElement('div');
        // Needed to properly position the annotation layer (e.g. links)
        divEl.style.position = "relative";

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

        this.shadowRoot.append(styleEl, divEl);

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
        // Attach HTML document to shadow root
        const htmlEl = document.createElement('html');

        htmlEl.appendChild(headEl);
        htmlEl.appendChild(bodyEl);

        this.shadowRoot.append(htmlEl);
        // We need the slide to be rendered with its styles
        // to measure its pixel dimensions
        await Promise.all(styleLoadedPromises)

        const scale = width / slideEl.clientWidth;
        const height = slideEl.clientHeight * scale;
        bodyEl.style.transformOrigin = '0 0';
        bodyEl.style.transform = `scale(${scale})`;
 
        // Set the custom element's height
        // (cannot let CSS compute the height because slides are absolutely
        // positioned most of the time...)
        styleEl.textContent = `
         :host { display: block; height: ${height}px; }
         :host([hidden]) { display: none; }
       `;
       headEl.appendChild(styleEl);
      }
    } catch (err) {
      console.error(err);
      this.shadowRoot.innerHTML = "";
      const doc = document.createElement('div');
      doc.innerHTML = this.innerHTML.trim() || `<a href="${this.src}">${this.src}</a>`;
      const styleEl = document.createElement('style');
      styleEl.textContent = `
        :host { display: block; }
        :host([hidden]) { display: none; }
      `;
      this.shadowRoot.append(styleEl, doc);
    }
  }


  /**
   * Listen to attribute changes and render slide appropriately.
   * 
   * Note the function gets called when attributes are initialized.
   */
  attributeChangedCallback(name, oldValue, newValue) {
    const src = this.getAttribute('src') ?
      new URL(this.getAttribute('src'), document.location.href).href :
      null;
    const width = this.getAttribute('width');
    const type = this.getAttribute('type');

    if ((this.src !== src) || (this.type !== type)) {
      this.src = src;
      this.type = type;
      this.width = width;
      this.fetch().then(() => this.render()).then(() => {
        this.loaded = true;
        this.dispatchEvent(new Event("load"));
      });
    }
    else if (this.width !== width) {
      this.width = width;
      this.render();
    }
  }


  /**
   * Load PDF.js libraries
   */
  async loadPDFScripts() {
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
