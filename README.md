# The `<i-slide>` Web component

This repository hosts a Web component that may be used to inline individual HTML/PDF slides of a slide set in an HTML page.

**Warning:** This component is at early stages of development and only supports a minimal set of features!


## Usage

```html
<!DOCTYPE html>
<html>
  <body>
    <h1>A slideset</h1>

    <p>This is slide 1:</p>
    <p><i-slide src="https://example.org/myslides.html#1"></i-slide></p>
    <p>Followed by slide 2:</p>
    <p><i-slide src="https://example.org/myslides.html#2"></i-slide></p>

    <p>PDF slides work too:</p>
    <p><i-slide src="https://example.org/myslides.pdf#page=1"></i-slide></p>

    <p>Fallback content can be specified:</p>
    <p><i-slide src="https://example.org/notfound#4">[Slide 4 of my slide set]</i-slide></p>

    <p>Content width can be set (300px by default):</p>
    <p><i-slide src="https://example.org/myslides.html#5" width="800"></i-slide></p>
    <p>Note: the height is set automatically based on the slide's aspect ratio.</p>

    <!-- Web component must be loaded as a module -->
    <script src="https://w3c.github.io/i-slide/i-slide.js" type="module"></script>
  </body>
</html>
```

See it in action in the [demo page](https://w3c.github.io/i-slide/demo.html).

**Important:** If the slide set is served from an origin different from the one where the component is used, [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) must be enabled for the slide set, meaning that the HTTP server that hosts the slide set needs to return an `Access-Control-Allow-Origin: *` HTTP header. This may already be the case (for instance, CORS is already enabled for all pages under `*.github.io`).

### Constraints

#### Supported slide formats

The Web element supports:

- HTML slides made with the [Shower Presentation Engine](https://shwr.me/)
- HTML slides made with the [b6+ slide framework](https://www.w3.org/Talks/Tools/b6plus/)
- PDF slides

#### Targeting individual slides

For HTML slides, the Web component supports numeric fragments that reference the slide number, starting at slide one, such as `#1`, `#2`, etc.

For PDF slides, the Web component supports page fragment references such as `#page=1`, `#page=2`, etc.


## Motivation

The `<i-slide>` Web component was created to ease creation of pages that interleave the transcript of a presentation with the slides that were presented, such as [Web Platform: a 30,000 feet view](https://www.w3.org/2020/06/machine-learning-workshop/talks/web_platform_a_30_000_feet_view_web_platform_and_js_environment_constraints.html) (that particular page does not use this component, it just illustrates a possible context in which it could be useful).

There are a variety of tools that may be used to create slides. Most of the time, slide sets may be embedded as a whole in a Web page, e.g. through an `<iframe>` element. It is also generally possible to target a specific slide within a slide set through some fragment convention (à la `#page=3`). The problem that this Web component attempts to solve arises when you want to reference all slides of a slide set one by one, as in the talk page mentioned above. If you take the `<iframe>` approach with a slide set that has `n` slides, you will need to download and render the slide set `n` times. This is particularly costly when the slide set embeds images or is in a format such as PDF that requires lots of processing to render in an HTML page.

This Web component includes logic to retrieve and render the slide set only once and distill rendered slides one by one throughout an HTML page.


## Development notes

- HTML slides are loaded and rendered without JavaScript.
- HTML slides are rendered inline within the shadow tree of the Web component. The code takes care of adding the right styles and scaling the result so that the content fits the available space.
- PDF slides are rendered in a `<canvas>` through [PDF.js](https://mozilla.github.io/pdf.js/).


## Contributing

Authors so far are [François Daoust](https://github.com/tidoust/) and [Dominique Hazaël-Massieux](https://github.com/dontcallmedom/).

Additional ideas, bugs and/or code contributions are most welcome. Create [issues on GitHub](https://github.com/w3c/i-slide/issues) as needed!


## Licensing

The code is available under an [MIT license](LICENSE).