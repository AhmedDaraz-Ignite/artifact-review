/*
 * Offline Mermaid page renderer for reviewed artifacts.
 *
 * The review SDK imports this bundle when an artifact contains Mermaid
 * blocks that nothing has rendered yet. It draws them with the same pinned
 * Mermaid version the whiteboard uses, so a reviewed page never depends on
 * a CDN to show its diagrams.
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

export async function renderPendingMermaid(doc = document) {
  const dark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: dark ? "dark" : "default",
  });

  const holders = [...doc.querySelectorAll("pre.mermaid, div.mermaid")].filter(
    holder =>
      !holder.getAttribute("data-processed") && !holder.querySelector("svg"),
  );

  let rendered = 0;
  for (const [index, holder] of holders.entries()) {
    const source = holderSource(holder);
    if (!source) continue;
    // Claim the block before drawing so a CDN copy of Mermaid loaded by the
    // artifact itself skips it instead of rendering it a second time.
    holder.setAttribute("data-processed", "true");
    try {
      const { svg } = await mermaid.render(
        `arev-page-mermaid-${index}`,
        source,
      );
      holder.innerHTML = svg;
      rendered += 1;
    } catch (error) {
      // A syntax error keeps the readable source text in place. The block
      // stays claimed so no other renderer retries it and shows a big error
      // graphic instead.
      console.warn("arev: could not render Mermaid block", holder.id, error);
    }
  }
  return rendered;
}

// Awaited at the top level so the SDK's dynamic import resolves only once
// every block has been drawn. That is what lets it audit the result.
await renderPendingMermaid();
