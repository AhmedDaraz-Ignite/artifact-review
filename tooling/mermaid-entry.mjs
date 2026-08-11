/*
 * Offline Mermaid page renderer for reviewed artifacts.
 *
 * The review SDK imports this bundle when an artifact contains Mermaid
 * blocks that nothing has rendered yet. It draws them with the same pinned
 * Mermaid version the whiteboard uses, so a reviewed page never depends on
 * a CDN to show its diagrams.
 *
 * Diagrams are styled from the page itself: the renderer reads the actually
 * rendered background and text colors, derives Mermaid theme variables from
 * them, and re-renders every block it owns when the page theme changes
 * (data-theme flips, class swaps, OS light/dark). Blocks the artifact
 * rendered on its own are never touched.
 */
import mermaid from "mermaid";

function holderSource(holder) {
  return (
    holder.getAttribute("data-arev-mermaid-source") ||
    holder.getAttribute("data-mermaid-source") ||
    holder.textContent ||
    ""
  ).trim();
}

/* ------------------------------------------------------- page palette */

let paintContext = null;

// Normalize any CSS color the browser produces (rgb, oklch, hsl, named)
// to [r, g, b, a] bytes via a 1x1 canvas, so parsing never breaks on
// modern color syntaxes.
function toRgba(color) {
  if (!paintContext) {
    paintContext = document.createElement("canvas").getContext("2d", {
      willReadFrequently: true,
    });
  }
  paintContext.clearRect(0, 0, 1, 1);
  paintContext.fillStyle = "#000";
  paintContext.fillStyle = color;
  paintContext.fillRect(0, 0, 1, 1);
  return [...paintContext.getImageData(0, 0, 1, 1).data];
}

function compositeRgba(foreground, background) {
  const fa = foreground[3] / 255;
  const ba = background[3] / 255;
  const alpha = fa + ba * (1 - fa);
  if (alpha === 0) return [0, 0, 0, 0];
  const mix = channel =>
    (foreground[channel] * fa + background[channel] * ba * (1 - fa)) / alpha;
  return [mix(0), mix(1), mix(2), alpha * 255];
}

function mixRgb(from, to, amount) {
  const blend = channel =>
    Math.round(from[channel] + (to[channel] - from[channel]) * amount);
  return [blend(0), blend(1), blend(2)];
}

function cssRgb(rgba) {
  return `rgb(${Math.round(rgba[0])}, ${Math.round(rgba[1])}, ${Math.round(rgba[2])})`;
}

// The effective page background: body composited over the root, so any
// theming mechanism (prefers-color-scheme, data-theme, plain CSS) is
// reflected by what actually painted.
function pageBackground(bodyStyle) {
  const rootBackground = toRgba(
    getComputedStyle(document.documentElement).backgroundColor,
  );
  const bodyBackground = document.body
    ? toRgba(bodyStyle.backgroundColor)
    : [0, 0, 0, 0];
  return compositeRgba(bodyBackground, rootBackground);
}

function pageIsDark(background) {
  const [r, g, b, a] = background;
  if (a > 0) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
  }
  const colorScheme = getComputedStyle(document.documentElement).colorScheme;
  if (colorScheme.includes("dark") && !colorScheme.includes("light")) return true;
  if (colorScheme.includes("light") && !colorScheme.includes("dark")) return false;
  return !!(
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

// Mermaid's base theme derives every diagram color from a few variables.
// Node surfaces, borders, and edges are mixes of the page background toward
// the page text color, so diagrams inherit any palette without clashing.
function pagePalette() {
  const bodyStyle = getComputedStyle(document.body || document.documentElement);
  const background = pageBackground(bodyStyle);
  const dark = pageIsDark(background);
  const text = toRgba(bodyStyle.color);
  const canvas =
    background[3] > 0 ? background : dark ? [24, 26, 31, 255] : [255, 255, 255, 255];
  return {
    dark,
    themeVariables: {
      darkMode: dark,
      background: cssRgb(canvas),
      fontFamily: bodyStyle.fontFamily || "sans-serif",
      primaryColor: cssRgb(mixRgb(canvas, text, 0.08)),
      primaryTextColor: cssRgb(text),
      // 0.28 lands on the palette's own strong line tone. A higher mix drifts
      // to a neutral grey that reads as a wire frame around every node.
      primaryBorderColor: cssRgb(mixRgb(canvas, text, 0.28)),
      lineColor: cssRgb(mixRgb(canvas, text, 0.55)),
      // Mermaid does not derive edge-label chips from the primary colors, so
      // an unset value leaves black chips on a dark page.
      edgeLabelBackground: cssRgb(mixRgb(canvas, text, 0.05)),
    },
  };
}

// Node boxes are rounded and their names are bold. `:not([rx])` leaves stadium
// and rounded shapes alone, since those carry the radius their own shape chose.
// Message and edge labels keep the normal weight so the node names stay the
// emphasis.
const NODE_SHAPE_CSS = [
  "g.node rect.basic:not([rx]){rx:8px;ry:8px}",
  "rect.actor{rx:8px;ry:8px}",
  "g.node .nodeLabel,text.actor,text.actor tspan{font-weight:600}",
].join("");

/* ------------------------------------------------------- rendering */

const owned = []; // blocks this renderer drew: { holder, source }
let generation = 0;
let applied = null;
let queued = false;
let rendering = false;

// The review tool draws its own SVG icons, and the resting edit control puts one
// inside the very block a diagram is drawn into. Only an SVG outside that chrome
// means the block already carries a picture.
function drawnSvg(holder) {
  return [...holder.querySelectorAll("svg")].find(
    svg => !svg.closest("[data-arev-internal]"),
  );
}

function collectPending() {
  const holders = [...document.querySelectorAll("pre.mermaid, div.mermaid")].filter(
    holder => !holder.getAttribute("data-processed") && !drawnSvg(holder),
  );
  for (const holder of holders) {
    const source = holderSource(holder);
    if (!source) continue;
    // Claim the block before drawing so a CDN copy of Mermaid loaded by the
    // artifact itself skips it instead of rendering it a second time.
    holder.setAttribute("data-processed", "true");
    owned.push({ holder, source });
  }
}

async function renderOwned() {
  const palette = pagePalette();
  const themeKey = JSON.stringify(palette.themeVariables);
  if (themeKey === applied) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: palette.themeVariables,
    themeCSS: NODE_SHAPE_CSS,
  });
  generation += 1;
  let rendered = 0;
  for (const [index, block] of owned.entries()) {
    if (!block.holder.isConnected) continue;
    try {
      const { svg } = await mermaid.render(
        `arev-page-mermaid-${index}-g${generation}`,
        block.source,
      );
      block.holder.innerHTML = svg;
      block.holder.setAttribute(
        "data-arev-mermaid-theme",
        palette.dark ? "dark" : "light",
      );
      rendered += 1;
    } catch (error) {
      // A syntax error keeps the readable source text in place. The block
      // stays claimed so no other renderer retries it and shows a big error
      // graphic instead.
      console.warn("arev: could not render Mermaid block", block.holder.id, error);
    }
  }
  applied = themeKey;
  if (rendered) {
    document.dispatchEvent(new CustomEvent("arev:mermaid-rendered"));
  }
}

// A theme flip during a render queues exactly one more pass. That stops a
// second renderer from racing the first.
async function drainRenderQueue() {
  if (rendering) return;
  rendering = true;
  try {
    while (queued) {
      queued = false;
      await renderOwned();
    }
  } finally {
    rendering = false;
  }
}

function queueRender() {
  // One queued frame absorbs a whole burst of theme events.
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => void drainRenderQueue());
}

function watchThemeChanges() {
  const observer = new MutationObserver(queueRender);
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    observer.observe(el, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style"],
    });
  }
  if (window.matchMedia) {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", queueRender);
  }
  // A theme toggle wired to a checkbox or select repaints without touching
  // root attributes. The background-color transition catches animated swaps.
  document.addEventListener("change", queueRender, true);
  document.addEventListener(
    "transitionend",
    event => {
      if (event.propertyName === "background-color") queueRender();
    },
    true,
  );
}

// Awaited at the top level so the SDK's dynamic import resolves only once
// every block has been drawn. That is what lets it audit the result.
collectPending();
await renderOwned();
watchThemeChanges();
