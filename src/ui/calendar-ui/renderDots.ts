export const SVG_NS = "http://www.w3.org/2000/svg";

export interface RenderedDot {
  className: string;
  isFilled: boolean;
}

/**
 * Deterministically replace a day/week cell's dots.
 *
 * Obsidian's Electron runtime can leave Svelte 5.56.3's compiled `{#each}`
 * reconciler with a stale empty container while sibling attribute effects keep
 * updating. Writing the SVGs directly keeps the dot state attached to the same
 * state source as `has-note` without competing with the reconciler.
 */
export function syncDotsDom(
  container: HTMLElement | null,
  dots: readonly RenderedDot[]
): void {
  if (!container) return;

  const frag = document.createDocumentFragment();
  for (const dot of dots) {
    const svg = document.createElementNS(SVG_NS, "svg");
    const base = dot.isFilled ? "dot filled" : "hollow";
    svg.setAttribute("class", dot.className ? `${base} ${dot.className}` : base);
    svg.setAttribute("viewBox", "0 0 6 6");
    svg.setAttribute("xmlns", SVG_NS);

    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", "3");
    circle.setAttribute("cy", "3");
    circle.setAttribute("r", "2");
    svg.appendChild(circle);
    frag.appendChild(svg);
  }

  container.replaceChildren(frag);
}
