import ISlide from './ISlide.js';
customElements.define('i-slide', ISlide);

const queryString = new URL(import.meta.url).search.slice(1);
const params = new URLSearchParams(queryString);
if (params.get("selector")) {
  document.querySelectorAll(params.get("selector")).forEach(
    el => {
      const newEl = document.createElement("i-slide");
      const src = el.getAttribute("href") || el.getAttribute("src") || el.dataset["islideSrc"];
      newEl.setAttribute("src", src);
      const srcref = el.dataset["srcref"] || el.dataset["islideSrcref"];
      if (srcref) {
        newEl.setAttribute("srcref", srcref);
      }
      el.replaceWith(newEl);
    });
}

