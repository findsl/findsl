// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * PAP-HTML-Emitter: self-contained HTML-Seite, die die Mermaid-Diagramme
 * SELBST rendert (kein CDN/Internet — mermaid.min.js inline eingebettet).
 *
 * Damit kontrollieren wir den Renderer und liefern, was die rohe `.md`-
 * Ausgabe nicht kann:
 *   - `securityLevel: 'loose'` → klickbare Gesetzes-§-Links.
 *   - hervorgehobene Diagramm-Titel + Zoom (Buttons / ⌘·Strg+Mausrad);
 *     `flowchart.useMaxWidth:false` rendert in natürlicher Größe.
 *   - EIGENE Hover-Tooltips (Mermaids native sind reiner Text): pro Knoten
 *     wird der Doc-Kommentar mit serverseitig gerendertem KaTeX als HTML
 *     gezeigt — `$$…$$`/`$…$` erscheinen als echte Math-Notation (wie im
 *     docgen). Lesbar in hell UND dunkel (prefers-color-scheme).
 *
 * Der Diagramm-Quelltext wird HTML-escapt ins `<pre class="mermaid">`
 * gelegt (das Label-`<br/>` würde der HTML-Parser sonst verschlucken).
 */

import {
    renderMermaid, LIGHT, DARK, LINE_COLOR,
    type MermaidOptions, type ClassStyle,
} from './mermaid.js';
import type { PapModul, NodeKind, FlowGraph } from './model.js';
import { MERMAID_JS, MERMAID_VERSION } from './mermaid-asset.generated.js';
import { renderMathHtml } from '../docgen/math.js';
import { KATEX_CSS } from '../docgen/katex-assets.js';

function htmlEscape(s: string): string {
    // Auch `"`/`'` escapen (Defense-in-Depth: htmlEscape wird u. a. in
    // `id="fn-…"`-Attributen genutzt). Im `<pre class="mermaid">` decodiert
    // der Browser via textContent zurück → Mermaid sieht das Original.
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Doc-Hover-Text → HTML: `$$…$$` (Block) / `$…$` (inline) via KaTeX,
 *  Prosa dazwischen HTML-escapt. Fällt bei KaTeX-Fehlern auf escapten
 *  Roh-TeX zurück (kein Crash bei kaputter Formel). */
function renderTooltipHtml(raw: string): string {
    const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
    let out = '';
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        out += htmlEscape(raw.slice(last, m.index));
        const tex = m[1] ?? m[2];
        const display = m[1] !== undefined;
        try {
            out += renderMathHtml(tex, display);
        } catch {
            out += htmlEscape(m[0]);
        }
        last = re.lastIndex;
    }
    out += htmlEscape(raw.slice(last));
    return out;
}

/** Seiten-CSS: Chrome, hervorgehobene Titel, Zoom-Viewport, eigene Hover-
 *  Tooltips — alles in hell/dunkel (prefers-color-scheme). */
const PAGE_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2rem;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #ffffff; color: #202124; line-height: 1.5;
}
h1 { font-size: 1.6rem; margin: 0 0 1.5rem; }
h2 {
  font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.05em;
  color: #80868b; margin: 2.5rem 0 0.75rem;
}
.diagram { margin: 0.75rem 0 2.25rem; }
.diagram-head { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
.diagram-title { font-size: 1.2rem; font-weight: 700; color: #1a73e8; }
.diagram-title::before { content: "\\25B6"; font-size: 0.65em; margin-right: 0.45rem; opacity: 0.6; }
.zoom-bar { margin-left: auto; display: flex; gap: 0.25rem; }
.zoom-bar button {
  font: inherit; font-size: 0.8rem; line-height: 1; padding: 0.35rem 0.6rem;
  border: 1px solid #dadce0; background: #f8f9fa; color: #202124;
  border-radius: 5px; cursor: pointer;
}
.zoom-bar button:hover { background: #e8eaed; }
.diagram-scroll {
  overflow: auto; max-height: 85vh; resize: vertical;
  border: 1px solid #dadce0; border-radius: 8px; padding: 0.75rem; background: #ffffff;
}
.diagram-scroll svg { max-width: none !important; }
footer { margin-top: 3rem; font-size: 0.8rem; color: #80868b; }
.pap-tooltip {
  position: fixed; display: none; z-index: 1000; pointer-events: none;
  max-width: 420px; padding: 8px 11px; border-radius: 6px;
  background: #ffffff; color: #202124; border: 1px solid #dadce0;
  box-shadow: 0 2px 10px rgba(0,0,0,0.18);
  font-size: 0.85rem; line-height: 1.5; text-align: left;
}
.pap-tooltip .katex { color: inherit; }
@media (prefers-color-scheme: dark) {
  body { background: #1f1f1f; color: #e8eaed; }
  h2 { color: #9aa0a6; }
  .diagram-title { color: #8ab4f8; }
  .zoom-bar button { background: #2a2d2e; color: #e8eaed; border-color: #5f6368; }
  .zoom-bar button:hover { background: #3c4043; }
  .diagram-scroll { border-color: #5f6368; background: #181818; }
  .pap-tooltip {
    background: #2a2d2e; color: #e8eaed; border-color: #5f6368;
    box-shadow: 0 2px 10px rgba(0,0,0,0.5);
  }
}`;

/** Zoom je Diagramm: Buttons (−/100%/+) und ⌘·Strg+Mausrad. */
const ZOOM_JS = `
document.querySelectorAll('.diagram').forEach(function (d) {
  var scroll = d.querySelector('.diagram-scroll');
  var scale = 1;
  function apply() {
    var svg = scroll.querySelector('svg');
    if (!svg) return;
    var vb = svg.viewBox && svg.viewBox.baseVal;
    var w = vb && vb.width ? vb.width : svg.getBoundingClientRect().width;
    svg.style.maxWidth = 'none';
    svg.style.height = 'auto';
    svg.style.width = (w * scale) + 'px';
  }
  d.querySelectorAll('.zoom-bar button').forEach(function (b) {
    b.addEventListener('click', function () {
      var z = b.getAttribute('data-z');
      if (z === 'in') scale *= 1.25; else if (z === 'out') scale /= 1.25; else scale = 1;
      scale = Math.max(0.2, Math.min(8, scale));
      apply();
    });
  });
  scroll.addEventListener('wheel', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    scale *= e.deltaY < 0 ? 1.1 : 0.9;
    scale = Math.max(0.2, Math.min(8, scale));
    apply();
  }, { passive: false });
});`;

/** Eigene Hover-Tooltips (KaTeX-HTML) an die Knoten hängen. Die Knoten-<g>
 *  tragen `id="mermaid-<session>-flowchart-<unsere Knoten-ID>-<n>"` (in
 *  Playwright verifiziert) — daher Substring-Match auf `flowchart-<id>-`
 *  (das Trenn-`-` verhindert n1/n10-Kollisionen; unsere IDs sind eindeutig). */
const TOOLTIP_JS = `
(function () {
  var tip = document.createElement('div');
  tip.className = 'pap-tooltip';
  document.body.appendChild(tip);
  Object.keys(PAP_TIPS).forEach(function (id) {
    var el = document.querySelector('[id*="flowchart-' + id + '-"]');
    if (!el) return;
    el.style.cursor = 'help';
    el.addEventListener('mouseenter', function () {
      tip.innerHTML = PAP_TIPS[id];
      tip.style.display = 'block';
    });
    el.addEventListener('mousemove', function (e) {
      tip.style.left = (e.clientX + 14) + 'px';
      tip.style.top = (e.clientY + 14) + 'px';
    });
    el.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
  });
})();`;

/** Knoten-/Kanten-Farben einer Helligkeit als Seiten-CSS. Wir rendern die
 *  Knoten FARBLOS (nur mit Art-Klasse, `klassen:true`) und färben hier —
 *  classDef würde Inline-`!important` setzen, das `prefers-color-scheme`
 *  nicht überschreiben könnte. So folgen die Diagramme dem OS-Hell/Dunkel. */
function schemeRules(
    pal: Record<NodeKind, ClassStyle>, line: string, text: string, edgeBg: string,
): string {
    const nodes = (Object.keys(pal) as NodeKind[]).map((k) => {
        const s = pal[k];
        return `.node.${k} rect,.node.${k} polygon,.node.${k} path`
            + `{fill:${s.fill}!important;stroke:${s.stroke}!important;stroke-width:1px!important}`;
    }).join('');
    return nodes
        + `.node .nodeLabel,.node foreignObject div{color:${text}!important}`
        + `.edgePaths path,.flowchart-link{stroke:${line}!important}`
        + `.edgePaths marker path,marker path{fill:${line}!important;stroke:${line}!important}`
        + `.edgeLabel,.edgeLabel p{color:${text}!important;background:${edgeBg}!important}`;
}

/** Hell + (per prefers-color-scheme) dunkel — der Diagramm-Farbsatz. */
const DIAGRAM_COLOR_CSS =
    schemeRules(LIGHT, LINE_COLOR.light, '#3c4043', '#ffffff')
    + `@media (prefers-color-scheme: dark){`
    + schemeRules(DARK, LINE_COLOR.dark, '#e3e3e3', '#1f1f1f')
    + `}`;

/** Präfixt alle Knoten-/Kanten-IDs eines Graphen (für eindeutige IDs, wenn
 *  mehrere Module auf einer Seite liegen). Reine Kopie — der Original-Graph
 *  bleibt unberührt (Markdown-Pfad nutzt ihn unpräfixiert weiter). */
function prefixGraph(g: FlowGraph, prefix: string): FlowGraph {
    const px = (id: string): string => prefix + id;
    return {
        ...g,
        nodes: g.nodes.map((n) => ({ ...n, id: px(n.id) })),
        edges: g.edges.map((e) => ({ ...e, from: px(e.from), to: px(e.to) })),
    };
}

/** Rendert ein oder mehrere Module als EINE self-contained HTML-Seite
 *  (mermaid + ggf. KaTeX-CSS genau einmal eingebettet). */
export function renderHtml(
    moduls: ReadonlyArray<PapModul>,
    opts: MermaidOptions = {},
): string {
    // Farblos rendern (nur Art-Klassen) + Seiten-CSS färbt hell/dunkel
    // (prefers-color-scheme). Theme fix `default` — die Helligkeit steuert
    // das OS, nicht --theme. Native Mermaid-Tooltips aus (eigene KaTeX-
    // Tooltips), §-Links (href) bleiben.
    const farbig = opts.farben !== false;
    const mermaidOpts: MermaidOptions = {
        ...opts, theme: 'default', tooltips: false, farben: false, klassen: farbig,
    };
    const tips: Record<string, string> = {};
    let hasMath = false;

    // Mehrere Module auf EINER Seite: gleichnamige fn aus verschiedenen
    // Modulen (z. B. `ZuVersteuerndesEinkommen` in est UND kst) erzeugten
    // sonst kollidierende Node-IDs (`${fn}_n${i}`) → überschriebene
    // Tooltips und doppelte DOM-Anker. Daher je Modul ein eindeutiges
    // Präfix. Bei nur einem Modul sind die IDs bereits eindeutig (Präfix
    // leer → Ausgabe byte-identisch zum Einzelmodul-Fall).
    const multiModul = moduls.length > 1;

    const body = moduls.map((m, mi) => {
        const prefix = multiModul ? `m${mi}_` : '';
        const diagrams = m.graphs.map((g) => {
            const pg = prefix ? prefixGraph(g, prefix) : g;
            for (const n of pg.nodes) {
                if (!n.tooltipRaw) continue;
                tips[n.id] = renderTooltipHtml(n.tooltipRaw);
                if (n.tooltipRaw.includes('$')) hasMath = true;
            }
            const fn = htmlEscape(pg.fnName);
            const anchor = htmlEscape(prefix + pg.fnName);
            return `<section class="diagram">\n`
                + `  <div class="diagram-head">\n`
                + `    <span class="diagram-title" id="fn-${anchor}">${fn}</span>\n`
                + `    <span class="zoom-bar">`
                + `<button data-z="out" title="verkleinern">−</button>`
                + `<button data-z="reset" title="100 %">100 %</button>`
                + `<button data-z="in" title="vergrößern">+</button></span>\n`
                + `  </div>\n`
                + `  <div class="diagram-scroll"><pre class="mermaid">`
                + `${htmlEscape(renderMermaid(pg, mermaidOpts))}</pre></div>\n`
                + `</section>`;
        }).join('\n');
        return `<h2>${htmlEscape(m.modul)}</h2>\n${diagrams}`;
    }).join('\n');

    // KaTeX-CSS nur einbetten, wenn überhaupt Mathe in den Tooltips steckt.
    const katexCss = hasMath ? `${KATEX_CSS}.katex{color:inherit}` : '';
    const farbCss = farbig ? DIAGRAM_COLOR_CSS : '';
    // `<` in den Tooltip-HTML-Strings escapen, damit ein `</script>` o. Ä.
    // das Inline-Skript nicht vorzeitig beendet.
    const tipsJson = JSON.stringify(tips).replace(/</g, '\\u003c');

    return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Programmablaufpläne</title>
<style>${PAGE_CSS}${katexCss}${farbCss}</style>
</head>
<body>
<h1>Programmablaufpläne</h1>
${body}
<footer>Erzeugt mit FinDSL · mermaid ${htmlEscape(MERMAID_VERSION)}</footer>
<script>${MERMAID_JS}</script>
<script>
// Das eingebettete Bundle exportiert nach mermaidBundle (esbuild-IIFE),
// die mermaid-API liegt unter .default.
var mermaid = (window.mermaidBundle && window.mermaidBundle.default) || window.mermaidBundle;
var PAP_TIPS = ${tipsJson};
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', flowchart: { useMaxWidth: false } });
function papSetup() {
${ZOOM_JS}
${TOOLTIP_JS}
}
// Setup nach dem Rendern — robust auch wenn run() kein Thenable liefert.
Promise.resolve(mermaid.run()).then(papSetup, papSetup);
</script>
</body>
</html>
`;
}
