import ISlide from './ISlide.js';
customElements.define('i-slide', ISlide);

const queryString = new URL(import.meta.url).search.slice(1);
const params = new URLSearchParams(queryString);
if (params.get("selector")) {
  document.querySelectorAll(params.get("selector")).forEach(
    el => {
      const newEl = document.createElement("i-slide");
      const src = el.getAttribute("href") || el.getAttribute("src") || el.dataset["islidesrc"];
      newEl.setAttribute("src", src);
      if (el.dataset["islidesrcref"]) {
	newEl.setAttribute("srcref", el.dataset["islidesrcref"]);
      }
      el.replaceWith(newEl);
    });
}

