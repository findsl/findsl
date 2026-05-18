/**
 * Doc-Generator — Single-File-HTML-Renderer im Starlight-Stil:
 * sticky Kopfleiste, linke Inhalts-Sidebar (aus dem `DocModel`), rechts
 * der Inhalt (markdown-it). Modernes, zurückhaltend-technisches Theme
 * mit Design-Tokens, Light/Dark (System + Umschalter), responsivem
 * Sidebar-Drawer (reines CSS), Scrollspy (progressive JS), A11y
 * (Fokus-Stile, Kontrast, reduced-motion) und Druck-Layout.
 *
 * Bewusst EINE eigenständige Datei — kein externes Asset, voll offline
 * (passt zum Lean/Audit-Ethos des Projekts).
 */

import MarkdownIt from 'markdown-it';
import type { DocModel } from './model.js';
import { renderMarkdown, kopfMarkdown, slug, groupDecls } from './markdown.js';
import { tokenizeFindsl } from './findsl-tokens.js';
import { installMathRules, renderMathHtml } from './math.js';
import { KATEX_CSS } from './katex-assets.js';
import type { DocKopf } from './kopf.js';

export interface HtmlOptions {
    readonly stand?: string;
    readonly titel?: string;
    /** Front-Matter-Dokumentkopf (Titel/Untertitel/Einleitung). Ohne
     *  Kopf bleibt der Default-Titel `FinDSL-Dokumentation`. */
    readonly kopf?: DocKopf;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"]/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

/**
 * FinDSL-Syntax-Highlight als HTML — mappt die Token des gemeinsamen
 * `tokenizeFindsl` (EINE Highlight-Quelle, geteilt mit dem PDF-Renderer)
 * auf `<span class="tok-…">`; alles escaped, `plain` als Klartext.
 */
function highlightFindsl(code: string): string {
    return tokenizeFindsl(code).map((t) =>
        t.kind === 'plain'
            ? escapeHtml(t.text)
            : `<span class="tok-${t.kind}">${escapeHtml(t.text)}</span>`,
    ).join('');
}

function md(): MarkdownIt {
    const m = new MarkdownIt({ html: false, linkify: true, typographer: false });
    const ids: string[] = [];
    m.core.ruler.push('collect-heading-ids', (state) => {
        const seen = new Map<string, number>();
        for (let i = 0; i < state.tokens.length; i++) {
            if (state.tokens[i].type !== 'heading_open') continue;
            const base = slug(state.tokens[i + 1]?.content ?? `h${i}`);
            // Bereichs-Headings (Konstanten, …) wiederholen sich je
            // Datei → eindeutige Anker durch `-2`,`-3`-Suffix.
            const n = (seen.get(base) ?? 0) + 1;
            seen.set(base, n);
            ids.push(n === 1 ? base : `${base}-${n}`);
        }
    });
    // Schlüsselwort am Anfang eines Deklarations-Titels (H4) in ein
    // eigenes Span fassen → dünne, farbige Unterstreichung via CSS.
    const KIND_RE = /^(konst|datensatz|fn|prüfe|aufzählung)(?=\s|$)/u;
    m.core.ruler.push('decl-keyword', (state) => {
        for (let i = 0; i < state.tokens.length; i++) {
            const t = state.tokens[i];
            if (t.type !== 'heading_open' || t.tag !== 'h4') continue;
            const inl = state.tokens[i + 1];
            const first = inl?.children?.[0];
            if (!first || first.type !== 'text') continue;
            const m2 = first.content.match(KIND_RE);
            if (!m2) continue;
            const kw = m2[0];
            const Tok = state.Token;
            const open = new Tok('kw_open', 'span', 1);
            const word = new Tok('text', '', 0); word.content = kw;
            const close = new Tok('kw_close', 'span', -1);
            const rest = new Tok('text', '', 0);
            rest.content = first.content.slice(kw.length);
            inl.children!.splice(0, 1, open, word, close, rest);
        }
    });
    // Datei-Pfad-Zeile: das `*`pfad`*`-Paragraph unmittelbar nach einem
    // Kapitel-Heading (H2) → `<p class="module-path">` (klein/ausgegraut
    // via CSS). Erkennung über die eindeutige Inline-Form
    // em → code_inline → em direkt nach `heading_close` (h2).
    m.core.ruler.push('module-path', (state) => {
        const t = state.tokens;
        for (let i = 0; i < t.length; i++) {
            if (t[i].type !== 'heading_open' || t[i].tag !== 'h2') continue;
            let j = i + 1;
            while (j < t.length && t[j].type !== 'heading_close') j++;
            const po = t[j + 1], inl = t[j + 2], pc = t[j + 3];
            if (po?.type !== 'paragraph_open' || inl?.type !== 'inline'
                || pc?.type !== 'paragraph_close') continue;
            const c = inl.children ?? [];
            if (c.length === 3 && c[0].type === 'em_open'
                && c[1].type === 'code_inline' && c[2].type === 'em_close') {
                po.attrJoin('class', 'module-path');
            }
        }
    });
    m.renderer.rules.kw_open = () => '<span class="decl-kw">';
    m.renderer.rules.kw_close = () => '</span>';
    let oi = 0, ci = 0;
    m.renderer.rules.heading_open = (tokens, idx, opts, _env, self) => {
        tokens[idx].attrSet('id', ids[oi++] ?? `h${idx}`);
        return self.renderToken(tokens, idx, opts);
    };
    // Permalink-Anker am Heading-Ende (= referenzierbar wie Sidebar).
    m.renderer.rules.heading_close = (tokens, idx, opts, _env, self) => {
        const id = ids[ci++] ?? '';
        const a = id
            ? `<a class="permalink" href="#${id}" aria-label="Permalink">#</a>`
            : '';
        return a + self.renderToken(tokens, idx, opts);
    };
    // FinDSL-Codeblöcke hervorheben; andere Sprachen wie Default.
    m.renderer.rules.fence = (tokens, idx) => {
        const t = tokens[idx];
        const info = t.info.trim().split(/\s+/)[0];
        if (info === 'findsl') {
            return `<pre class="hl"><code class="findsl">`
                + highlightFindsl(t.content.replace(/\n$/, '')) + `</code></pre>\n`;
        }
        return `<pre><code>${escapeHtml(t.content)}</code></pre>\n`;
    };
    // Mathe-Parser-Rules (gemeinsam mit PDF) + KaTeX-HTML-Renderer.
    // Die Renderer-Rules emittieren HTML direkt (wie `fence`/`kw_open`)
    // und sind daher von `html:false` unberührt; Fremd-HTML im
    // Prosatext bleibt weiterhin escaped.
    installMathRules(m);
    m.renderer.rules.math_inline = (tk, i) => renderMathHtml(tk[i].content, false);
    m.renderer.rules.math_block = (tk, i) =>
        `<div class="math-block">${renderMathHtml(tk[i].content, true)}</div>\n`;
    return m;
}

const KIND_BADGE: Record<string, string> = {
    konst: 'K', fn: 'ƒ', datensatz: 'D', 'aufzählung': 'A', 'prüfe': 'P',
};

/** Linke Navigation aus dem Modell, je Modul in Bereiche gruppiert
 *  (Anker = Slug wie die Inhalts-IDs). */
function sidebarNav(model: DocModel): string {
    const declLi = (kind: string, name: string): string => {
        const id = slug(`${kind} ${name}`);
        const badge = KIND_BADGE[kind] ?? '•';
        return `<li data-name="${escapeHtml(name.toLowerCase())}">`
            + `<a href="#${id}" data-target="${id}" title="${escapeHtml(`${kind} ${name}`)}">`
            + `<span class="badge badge-${escapeHtml(kind)}" aria-hidden="true">${badge}</span>`
            + `<span class="nav-name">${escapeHtml(name)}</span></a></li>`;
    };
    const groups = model.modules.map((m) => {
        const cats = groupDecls(m.decls).map((g) => {
            const items = g.decls.map((d) => declLi(d.kind, d.name)).join('');
            return `<li class="nav-cat-group">`
                + `<span class="nav-cat">${escapeHtml(g.header)}</span>`
                + `<ul>${items}</ul></li>`;
        }).join('');
        const mid = slug(m.name);
        return `<li class="nav-group" data-name="${escapeHtml(m.name.toLowerCase())}">`
            + `<a class="nav-module" href="#${mid}" data-target="${mid}" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</a>`
            + `<ul>${cats}</ul></li>`;
    }).join('');
    return `<nav class="toc" aria-label="Inhaltsverzeichnis"><ul>${groups}</ul></nav>`;
}

const THEME = String.raw`
:root{
  color-scheme:light dark;
  --bg:#fbfbfd; --surface:#ffffff; --sidebar:#f5f6f8;
  --fg:#1c1d2b; --muted:#5b5c70; --rule:#e6e7ee;
  --accent:#3b5bdb; --accent-soft:#eef1fe;
  --code-bg:#f3f4f7; --code-fg:#23243a;
  --badge-bg:#e7e9f5; --badge-fg:#3b5bdb;
  --radius:10px;
  --maxw:48rem; --sidew:18rem;
  --dur:160ms; --ease:cubic-bezier(.16,1,.3,1);
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#262624; --surface:#2f2e2c; --sidebar:#1f1e1d;
  --fg:#f5f4ee; --muted:#a8a59b; --rule:#3b3a37;
  --accent:#8aa0ff; --accent-soft:#2c2f44;
  --code-bg:#1f1e1d; --code-fg:#e9e7df;
  --badge-bg:#33322f; --badge-fg:#cfd6ff;
}}
:root[data-theme="dark"]{
  --bg:#262624; --surface:#2f2e2c; --sidebar:#1f1e1d;
  --fg:#f5f4ee; --muted:#a8a59b; --rule:#3b3a37;
  --accent:#8aa0ff; --accent-soft:#2c2f44;
  --code-bg:#1f1e1d; --code-fg:#e9e7df;
  --badge-bg:#33322f; --badge-fg:#cfd6ff;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:5rem}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}
body{margin:0;background:var(--bg);color:var(--fg);
  font:16px/1.65 var(--font);-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}

/* Kopfleiste */
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:1rem;
  height:3.75rem;padding:0 1.25rem;background:color-mix(in oklab,var(--surface) 88%,transparent);
  backdrop-filter:saturate(180%) blur(8px);border-bottom:1px solid var(--rule)}
.topbar .brand{font-weight:700;font-size:1.05rem;letter-spacing:-.01em}
.topbar .stand{color:var(--muted);font-size:.82rem;white-space:nowrap}
.topsearch{flex:1;display:flex;justify-content:center;min-width:0;
  margin:0 .5rem}
.topsearch input{width:100%;max-width:34rem;padding:.5rem .85rem;
  border:1px solid var(--rule);border-radius:9px;background:var(--bg);
  color:var(--fg);font:inherit;font-size:.9rem;
  transition:border-color var(--dur) var(--ease),box-shadow var(--dur) var(--ease)}
.topsearch input::placeholder{color:var(--muted)}
.topsearch input:focus-visible{outline:none;border-color:var(--accent);
  box-shadow:0 0 0 3px var(--accent-soft)}
.iconbtn{appearance:none;border:1px solid var(--rule);background:var(--surface);
  color:var(--fg);width:2.25rem;height:2.25rem;border-radius:8px;cursor:pointer;
  font-size:1rem;display:grid;place-items:center;transition:background var(--dur) var(--ease)}
.iconbtn:hover{background:var(--accent-soft)}
.menu-btn{display:none}

/* Layout-Grid */
.layout{display:grid;grid-template-columns:var(--sidew) minmax(0,1fr);
  align-items:start;max-width:80rem;margin:0 auto}
.sidebar{position:sticky;top:3.75rem;height:calc(100dvh - 3.75rem);
  overflow-y:auto;overflow-x:hidden;
  background:var(--sidebar);border-right:1px solid var(--rule);padding:1.25rem 0}
.toc ul{list-style:none;margin:0;padding:0}
.toc>ul>li.nav-group{margin:0 0 1.1rem}
.nav-module{display:block;padding:.35rem 1.25rem;font-weight:700;font-size:.74rem;
  text-transform:uppercase;letter-spacing:.05em;color:var(--muted);
  overflow-wrap:anywhere;line-height:1.35}
.nav-module:hover{color:var(--accent);text-decoration:none}
.nav-cat{display:block;padding:.55rem 1.25rem .15rem;font-size:.66rem;
  font-weight:700;text-transform:uppercase;letter-spacing:.07em;
  color:var(--muted);opacity:.75}
.nav-cat-group[hidden]{display:none}
.toc li a{display:flex;align-items:center;gap:.55rem;padding:.32rem 1.25rem .32rem 1.25rem;
  color:var(--fg);font-size:.92rem;border-left:2px solid transparent}
.toc li ul a{padding-left:1.6rem}
.toc li a:hover{background:var(--accent-soft);text-decoration:none}
.toc li a.active{color:var(--accent);border-left-color:var(--accent);
  background:var(--accent-soft);font-weight:600}
.badge{flex:none;width:1.25rem;height:1.25rem;border-radius:5px;display:grid;
  place-items:center;font-size:.7rem;font-weight:700;font-family:var(--mono);
  background:var(--badge-bg);color:var(--badge-fg)}
.nav-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Suche (Treffer-Status in der Sidebar; Eingabe steht im Header) */
.search-empty{margin:.9rem 1.25rem;color:var(--muted);font-size:.9rem}
.nav-group[hidden],.toc li[hidden]{display:none}

/* Permalink-Anker an Headings */
.content :is(h2,h3,h4,h5):not(h3){position:relative}
.permalink{position:absolute;left:-1.15em;top:0;color:var(--muted);
  opacity:0;text-decoration:none;font-weight:400;
  transition:opacity var(--dur) var(--ease)}
.content :is(h2,h4,h5):hover .permalink,.permalink:focus-visible{opacity:1}
.permalink:hover{color:var(--accent);text-decoration:none}

/* FinDSL-Syntax-Highlight (theme-aware) */
:root{
  --tk-kw:#9a2bd8; --tk-type:#0a7d6c; --tk-str:#b3541e;
  --tk-num:#1f6feb; --tk-com:#8a8d9c; --tk-anno:#a8341f;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --tk-kw:#d39bff; --tk-type:#5fd3bd; --tk-str:#e0a06a;
  --tk-num:#86b4ff; --tk-com:#7d8198; --tk-anno:#ff9b86;
}}
:root[data-theme="dark"]{
  --tk-kw:#d39bff; --tk-type:#5fd3bd; --tk-str:#e0a06a;
  --tk-num:#86b4ff; --tk-com:#7d8198; --tk-anno:#ff9b86;
}
.findsl .tok-kw{color:var(--tk-kw);font-weight:600}
.findsl .tok-type{color:var(--tk-type)}
.findsl .tok-str{color:var(--tk-str)}
.findsl .tok-num{color:var(--tk-num)}
.findsl .tok-com{color:var(--tk-com);font-style:italic}
.findsl .tok-anno{color:var(--tk-anno);font-weight:600}

/* Inhalt */
main{padding:2.5rem 2.5rem 6rem}
.content{max-width:var(--maxw)}
.content h1,.content h2,.content h4{line-height:1.25;letter-spacing:-.015em}
.content h2{font-size:1.75rem;margin:3rem 0 1rem;padding-bottom:.4rem;
  border-bottom:1px solid var(--rule);scroll-margin-top:5rem}
.content h2:first-child{margin-top:0}
/* Relativer Dateipfad: kleine, ausgegraute Zeile direkt unter dem
   Kapitelnamen (H2 = Datei). */
.content p.module-path{margin:-.7rem 0 1.6rem;font-size:.8rem;
  color:var(--muted);font-style:normal}
.content p.module-path em{font-style:normal}
.content p.module-path code{background:none;padding:0;font-size:.95em;
  color:var(--muted)}
/* H3 = Bereich (Konstanten/Funktionen/…) — Starlight-Kategorie */
.content h3{font-size:.78rem;font-weight:700;text-transform:uppercase;
  letter-spacing:.09em;color:var(--muted);margin:2.8rem 0 .9rem;
  padding-bottom:.35rem;border-bottom:1px solid var(--rule);
  scroll-margin-top:5rem}
/* H4 = Deklaration (prominent; Textfarbe statt Akzent —
   light = schwarz, dark = weiß) */
.content h4{font-size:1.2rem;font-weight:700;color:var(--fg);
  margin:2rem 0 .55rem;scroll-margin-top:5rem}
/* Schlüsselwort (konst/fn/…) im Titel: sehr dünne, passende Linie */
.content h4 .decl-kw{text-decoration:underline;
  text-decoration-color:var(--tk-kw);text-decoration-thickness:1px;
  text-underline-offset:4px}
/* H5/H6 = Unterüberschriften aus Doc-Kommentaren */
.content h5{font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;
  color:var(--muted);margin:1.5rem 0 .5rem;line-height:1.3}
.content h6{font-size:.8rem;font-weight:700;color:var(--muted);
  margin:1.2rem 0 .4rem;line-height:1.3}
.content p{margin:.7rem 0}
.content code{background:var(--code-bg);color:var(--code-fg);
  padding:.12em .4em;border-radius:5px;font:.88em/1.5 var(--mono)}
.content pre{background:var(--code-bg);border:1px solid var(--rule);
  border-radius:var(--radius);padding:1rem 1.1rem;overflow:auto;margin:1rem 0;
  position:relative}
.content pre::before{content:"findsl";position:absolute;top:0;right:0;
  font:.66rem/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;
  color:var(--muted);background:var(--surface);border:1px solid var(--rule);
  border-top:none;border-right:none;border-bottom-left-radius:7px;padding:.3rem .55rem}
.content pre code{background:none;padding:0;color:var(--code-fg);font-size:.85rem}
.content table{border-collapse:collapse;width:100%;margin:1.1rem 0;font-size:.92rem;
  border:1px solid var(--rule);border-radius:var(--radius);overflow:hidden}
.content th,.content td{padding:.55rem .8rem;text-align:left;
  border-bottom:1px solid var(--rule)}
.content th{background:var(--code-bg);font-weight:600}
.content tr:last-child td{border-bottom:none}
/* @Quelle-Callout: erste Liste nach einem "Quellen:"-Absatz */
.content p strong+br,.content p>strong:only-child{color:var(--fg)}
/* Quelle-Aside: klein, leise — dünne neutrale Leiste, kein Hintergrund */
.content blockquote{margin:.85rem 0;padding:.1rem 0 .1rem .8rem;
  border-left:2px solid var(--rule);background:none;color:var(--muted);
  font-size:.82rem;line-height:1.5}
.content blockquote p{margin:.1rem 0}
.content blockquote a{color:var(--accent)}
footer{max-width:var(--maxw);margin:4rem 0 0;padding-top:1.2rem;
  border-top:1px solid var(--rule);color:var(--muted);font-size:.82rem}

/* Drawer (responsiv, reines CSS via Checkbox) */
#nav-toggle{position:absolute;opacity:0;pointer-events:none}
.scrim{display:none}
@media (max-width:60rem){
  .menu-btn{display:grid}
  .topbar .stand{display:none}
  .topsearch input{max-width:none}
  .layout{grid-template-columns:minmax(0,1fr)}
  .sidebar{position:fixed;top:3.75rem;left:0;width:min(86vw,var(--sidew));
    transform:translateX(-104%);transition:transform var(--dur) var(--ease);z-index:30}
  #nav-toggle:checked~.layout .sidebar{transform:translateX(0)}
  #nav-toggle:checked~.layout .scrim{display:block;position:fixed;inset:3.75rem 0 0;
    background:rgba(0,0,0,.4);z-index:25}
  main{padding:1.75rem 1.25rem 5rem}
}

/* Druck: Sidebar/Topbar weg, je Modul neue Seite */
@media print{
  .topbar,.sidebar,.scrim{display:none!important}
  .layout{display:block;max-width:none}
  main{padding:0}
  .content{max-width:none}
  .content h2{page-break-before:always}
  .content h2:first-of-type{page-break-before:avoid}
  a{color:inherit;text-decoration:underline}
}
`;

const SCRIPT = String.raw`
(function(){
  // Theme-Umschalter mit Persistenz (progressive Enhancement).
  var root=document.documentElement,KEY="findsl-doc-theme";
  try{var s=localStorage.getItem(KEY);if(s)root.setAttribute("data-theme",s);}catch(e){}
  var tb=document.getElementById("theme-btn");
  if(tb)tb.addEventListener("click",function(){
    var cur=root.getAttribute("data-theme");
    var dark=cur?cur==="dark":matchMedia("(prefers-color-scheme:dark)").matches;
    var next=dark?"light":"dark";root.setAttribute("data-theme",next);
    try{localStorage.setItem(KEY,next);}catch(e){}
  });
  // Drawer nach Klick auf einen Link schließen.
  var cb=document.getElementById("nav-toggle");
  document.querySelectorAll(".toc a").forEach(function(a){
    a.addEventListener("click",function(){if(cb)cb.checked=false;});
  });
  // Sidebar-Suche: filtert Modul-/Decl-Einträge nach Substring.
  var box=document.getElementById("doc-search");
  var empty=document.querySelector(".search-empty");
  if(box)box.addEventListener("input",function(){
    var q=box.value.trim().toLowerCase();
    var groups=document.querySelectorAll(".nav-group"),visible=0;
    groups.forEach(function(g){
      var gm=q===""||(g.dataset.name||"").indexOf(q)>=0,any=false;
      g.querySelectorAll("li[data-name]").forEach(function(li){
        var m=q===""||gm||(li.dataset.name||"").indexOf(q)>=0;
        li.hidden=!m;if(m)any=true;
      });
      g.querySelectorAll(".nav-cat-group").forEach(function(cg){
        var cany=false;
        cg.querySelectorAll("li[data-name]").forEach(function(li){
          if(!li.hidden)cany=true;});
        cg.hidden=!(q===""||gm||cany);
      });
      var show=q===""||gm||any;g.hidden=!show;if(show)visible++;
    });
    if(empty)empty.hidden=!(q!==""&&visible===0);
  });
  // Scrollspy: aktiven Sidebar-Link markieren.
  var links={};document.querySelectorAll(".toc a[data-target]").forEach(function(a){
    links[a.getAttribute("data-target")]=a;});
  var ids=Object.keys(links);if(!ids.length||!("IntersectionObserver"in window))return;
  var io=new IntersectionObserver(function(es){
    es.forEach(function(en){
      if(en.isIntersecting){
        for(var k in links)links[k].classList.remove("active");
        var l=links[en.target.id];if(l)l.classList.add("active");
      }});
  },{rootMargin:"-72px 0px -70% 0px"});
  ids.forEach(function(id){var el=document.getElementById(id);if(el)io.observe(el);});
})();
`;

/** Rendert das Modell als eigenständige, themed Single-File-HTML. */
export function renderHtml(model: DocModel, opts: HtmlOptions = {}): string {
    const titel = opts.kopf?.titel ?? opts.titel ?? 'FinDSL-Dokumentation';
    const stand = opts.stand
        ? `<span class="stand">Stand: ${escapeHtml(opts.stand)}</span>` : '';
    // Content ohne Titel/Inline-ToC — die Sidebar ersetzt das ToC.
    const body = md().render(renderMarkdown(model, { title: false, toc: false }));
    // Deckblatt/Einleitung aus dem Front-Matter-Kopf (Titel, Untertitel,
    // Metablock, Vorwort) — vor dem Modul-Inhalt; ohne Kopf entfällt es.
    const cover = opts.kopf
        ? `<section class="doc-cover">${md().render(kopfMarkdown(opts.kopf))}</section>\n`
        : '';

    return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(titel)}</title>
<style>${THEME}${KATEX_CSS}.katex{color:inherit}.math-block{margin:1em 0;overflow-x:auto}</style>
</head>
<body>
<input type="checkbox" id="nav-toggle" aria-hidden="true">
<header class="topbar">
<label class="iconbtn menu-btn" for="nav-toggle" aria-label="Inhalt umschalten" title="Inhalt">☰</label>
<span class="brand">${escapeHtml(titel)}</span>
${stand}
<div class="topsearch">
<input id="doc-search" type="search" placeholder="Dokumentation durchsuchen…" aria-label="Dokumentation durchsuchen" autocomplete="off">
</div>
<button class="iconbtn" id="theme-btn" type="button" aria-label="Hell/Dunkel umschalten" title="Theme">◐</button>
</header>
<div class="layout">
<label class="scrim" for="nav-toggle" aria-hidden="true"></label>
<aside class="sidebar">
${sidebarNav(model)}
<p class="search-empty" hidden>Keine Treffer.</p>
</aside>
<main>
<article class="content">
${cover}${body}
<footer>Generiert mit FinDSL · <code>findsl doku</code></footer>
</article>
</main>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
