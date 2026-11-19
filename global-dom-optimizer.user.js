// ==UserScript==
// @name         Global DOM Optimizer
// @namespace    arkflame.global-dom-optimizer
// @version      0.0.9
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjI5IiBmaWxsPSIjMGQxNTFjIi8+PHBhdGggZD0iTTMyIDg5QzMwIDU0IDQ5IDM0IDEwMiAyNWMwIDQ2LTIyIDc1LTU5IDcyLTQtMTEtNS0yNSAwLTM3LTcgMTAtMTEgMjAtMTEgMjlaIiBmaWxsPSIjMWZlNzc5Ii8+PHBhdGggZD0iTTI1IDEwNkMzMyA3NyA1MSA1NSA4MyA0MiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNTNmZjliIiBzdHJva2Utd2lkdGg9IjciIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvc3ZnPg==
// @description  Skip rendering for off-screen blocks on long pages via viewport-aware content-visibility containment — the DOM stays intact, no data collection.
// @author       LucianoSkx - Violentmonkey port based on the original Global DOM Optimizer browser extension by ArkFlame Studios (https://arkflame.com)
// @homepageURL  https://github.com/LucianoSkx/global-dom-optimizer-userscript
// @supportURL   https://github.com/LucianoSkx/global-dom-optimizer-userscript/issues
// @downloadURL  https://raw.githubusercontent.com/LucianoSkx/global-dom-optimizer-userscript/main/global-dom-optimizer.user.js
// @updateURL    https://raw.githubusercontent.com/LucianoSkx/global-dom-optimizer-userscript/main/global-dom-optimizer.user.js
// @license      MIT
// @compatible   firefox 125+
// @compatible   chrome 85+
// @compatible   edge 85+
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';
  if (!CSS.supports('content-visibility', 'auto') || !CSS.supports('contain-intrinsic-block-size', 'auto 200px')) return;

  const ATTR = 'data-gdo-contained', FAR = 'data-gdo-far', SIZE = '--gdo-intrinsic-block';
  const LEAVES = 'p,pre,blockquote,li,dt,dd,figcaption,h1,h2,h3,h4,h5,h6';
  const CANDIDATES = LEAVES + ',section,article,figure,picture,div,ul,ol,dl';
  const OUTSIDE = 'head,nav,header,footer,aside,form,dialog,[role="navigation"],[role="toolbar"],[role="dialog"],[role="menu"],[role="menubar"],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"])';
  const UNSAFE = 'input,textarea,select,iframe,video,audio,canvas,object,embed,form,dialog,[role="dialog"],[contenteditable]:not([contenteditable="false"])';
  const LEAF = new Set(['P','PRE','BLOCKQUOTE','LI','DT','DD','FIGCAPTION','H1','H2','H3','H4','H5','H6']);
  const containerTags = new Set(['DIV','SECTION','ARTICLE','FIGURE','PICTURE','UL','OL','DL']);
  const applied = new Set(), originals = new WeakMap(), edited = new WeakMap(), blockHeights = new WeakMap();
  let geometryRejected = new WeakSet();
  const cellSize = 512, regions = new Map(), indexed = new WeakMap(), nearRecheck = new Map();
  let activeScrollRoot = null, fullRetries = 0;
  let scrollableCache = new WeakMap();
  const listeningRoots = new Set();
  const reasons = {};

  const host = () => location.hostname;
  const normalizeHosts = v => Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  let settings = {
    enabled: GM_getValue('enabled', true) !== false,
    excludedHosts: normalizeHosts(GM_getValue('excludedHosts', [])),
  };

  let scheduled = 0, running = false, generation = 0, pendingRescan = 0, watcher;
  let io, lastUrl = location.href, regionTimer = 0;
  let fullRescan = true;
  const dirtyRoots = new Set();
  let lastMutationAt = 0;
  let farCount = 0, hiddenHeight = 0, totalScrollHeight = 0;
  const stats = {scanned:0,eligible:0,contained:0,far:0,added:0,scanMs:0,workMs:0,scans:0,scanType:'initial',scrollRoot:'unknown',reason:'Starting',cachedRegions:0,gridChecks:0,fullScans:0,localScans:0,coverage:0,hiddenHeight:0,trackedHeight:0,updatedAt:0};
  const stamp = () => performance.now();
  const active = () => settings.enabled && !settings.excludedHosts.includes(host());
  const reject = key => { reasons[key] = (reasons[key]||0)+1; return null; };
  const rootScroll = () => document.scrollingElement || document.documentElement;
  const px = value => parseFloat(value)||0;

  const pageStyle = document.createElement('style');
  pageStyle.textContent =
    `[data-gdo-contained="1"]{content-visibility:auto !important;contain-intrinsic-block-size:auto var(--gdo-intrinsic-block,250px) !important}` +
    `[data-gdo-contained="1"][data-gdo-far]{content-visibility:hidden !important}` +
    `@media print{[data-gdo-contained="1"]{content-visibility:visible !important;contain-intrinsic-block-size:none !important}}`;
  (document.head || document.documentElement).appendChild(pageStyle);

  function scrollParent(e) {
    for (let p=e.parentElement; p && p!==document.body && p!==document.documentElement; p=p.parentElement) {
      let scrollable=scrollableCache.get(p);
      if (scrollable===undefined) {
        scrollable=p.clientHeight>0 && p.scrollHeight>p.clientHeight+48 &&
          /auto|scroll|overlay/.test(getComputedStyle(p).overflowY);
        scrollableCache.set(p,scrollable);
      }
      if(scrollable) return p;
    }
    return rootScroll();
  }
  function scrollView(p) {
    if (p===rootScroll() || p===document.body || p===document.documentElement) return {top:0,bottom:innerHeight,height:innerHeight};
    const r=p.getBoundingClientRect(),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
    return {top,bottom,height:Math.max(0,bottom-top)};
  }
  function rootLabel(p) {return p?`${p.tagName.toLowerCase()}${p.id?'#'+p.id:''} (${p.scrollHeight}px / ${p.clientHeight}px)`:'No scroll container discovered';}
  function cellOf(e,scroller) {
    const b=e.getBoundingClientRect();
    const r=scroller===rootScroll()?{top:0}:scroller.getBoundingClientRect();
    return Math.floor((b.top-r.top+scroller.scrollTop)/cellSize);
  }
  function cacheCandidate(e,scroller) {
    if (!scroller || !e.isConnected) return;
    const cell=cellOf(e,scroller),existing=indexed.get(e);
    if (existing && existing.root===scroller && existing.cell===cell && regions.get(scroller)?.get(cell)?.has(e)) return;
    if(existing) regions.get(existing.root)?.get(existing.cell)?.delete(e);
    let grid=regions.get(scroller);if(!grid){grid=new Map();regions.set(scroller,grid);}
    let bucket=grid.get(cell);if(!bucket){bucket=new Set();grid.set(cell,bucket);}
    bucket.add(e);indexed.set(e,{root:scroller,cell});
    if (scroller!==rootScroll() && !listeningRoots.has(scroller) && scroller.scrollHeight>scroller.clientHeight+50) {
      listeningRoots.add(scroller);
      scroller.addEventListener('scroll',onRegionScroll,{passive:true});
    }
  }
  function scrollerFromContent() {
    if(activeScrollRoot?.isConnected && activeScrollRoot.scrollHeight>activeScrollRoot.clientHeight+48) return activeScrollRoot;
    const samples=document.querySelectorAll('p,pre,blockquote,article,main,[role="feed"],[role="article"]');
    let best=null,bestExtent=0;
    for(let i=0;i<samples.length && i<120;i+=Math.max(1,Math.floor(samples.length/75))) {
      const p=scrollParent(samples[i]),extent=p.scrollHeight-p.clientHeight;
      if(extent>bestExtent && p.clientHeight>40){best=p;bestExtent=extent;}
    }
    const p=rootScroll();if(p.scrollHeight-p.clientHeight>bestExtent && p.clientHeight>40) best=p;
    activeScrollRoot=best;return best;
  }
  function onRegionScroll() {
    if (!active() || regionTimer) return;
    regionTimer=requestAnimationFrame(()=>{regionTimer=0;revisitVisibleCells();});
  }
  function revisitVisibleCells() {
    for (const [root,grid] of regions) {
      if (!root.isConnected) {root.removeEventListener('scroll',onRegionScroll);listeningRoots.delete(root);regions.delete(root);continue;}
      const view=root===rootScroll()?innerHeight:root.clientHeight;
      const low=Math.floor((root.scrollTop-view*.5)/cellSize),high=Math.floor((root.scrollTop+view*1.5)/cellSize);
      for(let cell=low;cell<=high;cell++) {
        const bucket=grid.get(cell);if(!bucket)continue;
        for(const e of bucket) {
          if(!e.isConnected){bucket.delete(e);continue;}
          if(nearRecheck.has(e) && !applied.has(e)) {dirtyRoots.add(e);nearRecheck.delete(e);stats.gridChecks++;}
        }
      }
    }
    if(dirtyRoots.size) schedule(100);
  }
  function remove(e) {
    if (!applied.has(e)) return;
    io?.unobserve(e);
    const wasFar=e.hasAttribute(FAR);
    e.removeAttribute(ATTR); e.removeAttribute(FAR);
    const o=originals.get(e);
    if (o) {
      if (o.had) e.style.setProperty(SIZE,o.value,o.priority);
      else e.style.removeProperty(SIZE);
    }
    if (wasFar) {farCount=Math.max(0,farCount-1);hiddenHeight=Math.max(0,hiddenHeight-(blockHeights.get(e)||0));}
    applied.delete(e);
  }
  // Resize/toggle dão outra chance a blocos que sofreram rollback de geometria
  function removeAll() {for (const e of applied) remove(e);farCount=0;hiddenHeight=0;totalScrollHeight=0;stats.contained=0;stats.far=0;stats.coverage=0;geometryRejected = new WeakSet();}
  function resetRegions() {
    scrollableCache=new WeakMap();
    for (const root of listeningRoots) root.removeEventListener('scroll',onRegionScroll);
    listeningRoots.clear();regions.clear();nearRecheck.clear();activeScrollRoot=null;
  }
  function cancel() {generation++;if(scheduled)clearTimeout(scheduled);if(pendingRescan)clearTimeout(pendingRescan);pendingRescan=0;scheduled=0;running=false;dirtyRoots.clear();fullRescan=true;resetRegions();fullRetries=0;if(regionTimer)cancelAnimationFrame(regionTimer);regionTimer=0;}
  function updateFar() {
    stats.far=farCount;
    stats.hiddenHeight=Math.round(hiddenHeight);
    stats.coverage=totalScrollHeight>0?Math.min(100,Math.round(hiddenHeight*100/totalScrollHeight)):0;
    stats.updatedAt=Date.now();
  }
  function intersection(events) {
    if (!active()) return;
    for (const ent of events) {
      if (!applied.has(ent.target)) continue;
      const hide=!ent.isIntersecting && !ent.target.contains(document.activeElement);
      if(ent.target.hasAttribute(FAR)!==hide){ent.target.toggleAttribute(FAR,hide);farCount+=hide?1:-1;hiddenHeight+= (hide?1:-1)*(blockHeights.get(ent.target)||0);}
    }
    updateFar();
    if (applied.size) stats.reason=`Containment active (${stats.far} blocks explicitly skipped)`;
    refreshOverlay();
  }
  function observer() {
    io?.disconnect();
    io = new IntersectionObserver(intersection,{root:null,rootMargin:'0px',scrollMargin:'96px 0px 96px 0px',threshold:0});
    farCount=0;hiddenHeight=0;
    for (const e of applied) {
      e.removeAttribute(FAR);
      io.observe(e);
    }
    updateFar();
  }
  function roots() {return document.body?[document.body]:[];}
  function collect(scope) {
    const result=[],seen=new Set(),limit=12000;
    for (const root of scope) {
      if (!root?.isConnected) continue;
      if (root.matches?.(CANDIDATES) && !seen.has(root)) {seen.add(root);result.push(root);}
      for (const e of root.querySelectorAll(CANDIDATES)) {
        if (!seen.has(e)) {seen.add(e);result.push(e);}
        if (result.length>=limit) return result;
      }
    }
    return result;
  }
  function contentLength(e) {
    if (e.childElementCount>12 && !LEAF.has(e.tagName)) return 0;
    return (e.textContent||'').trim().length;
  }
  function hasBlockChildren(e) {
    return !!e.querySelector(CANDIDATES + ',table,details,summary,hr');
  }
  function candidate(e) {
    if (!e.isConnected || applied.has(e)) return reject('alreadyContained');
    if (geometryRejected.has(e)) return reject('geometryRejected');
    const leaf=LEAF.has(e.tagName);
    if (!leaf && !containerTags.has(e.tagName)) return reject('notCandidate');
    if (e.closest(OUTSIDE)) return reject('navigationOrEditable');
    if (e.contains(document.activeElement) && document.activeElement!==document.body) return reject('focused');
    if (e.querySelector(UNSAFE)) return reject('interactive');
    const lastEdit=edited.get(e);
    if (lastEdit && stamp()-lastEdit<850) { const sc=scrollParent(e);cacheCandidate(e,sc);nearRecheck.set(e,true);return reject('recentlyEdited'); }
    if (!leaf && !(e.tagName==='FIGURE' && e.querySelector('img,picture,svg')) && hasBlockChildren(e)) return reject('hasIndependentChildren');
    const len=contentLength(e);
    const media=!leaf && !!e.querySelector('img,svg,picture') && e.childElementCount<=5;
    if (!len && !media) return reject('emptyText');

    const s=getComputedStyle(e);
    if (!['block','flow-root','list-item','flex'].includes(s.display) ||
        (s.display==='flex' && !s.flexDirection.startsWith('column')) ||
        !['static','relative'].includes(s.position) || s.float!=='none' ||
        s.visibility!=='visible' || s.contentVisibility!=='visible' ||
        s.animationName!=='none' || s.transform!=='none' || s.filter!=='none' ||
        s.columnCount!=='auto' && s.columnCount!=='1' ||
        /scroll|auto/.test(s.overflowY) || /scroll|auto/.test(s.overflowX)) return reject('layoutStyle');
    const parent=e.parentElement;
    if (parent) {
      const ps=getComputedStyle(parent);
      if ((ps.display==='grid' && ps.gridTemplateColumns.split(' ').filter(Boolean).length>1) ||
          (ps.display==='flex' && ps.flexDirection.startsWith('row') && parent.childElementCount>1)) return reject('directMultiColumnItem');
    }
    if (!leaf && e.firstElementChild && e.lastElementChild &&
        !['flow-root','flex'].includes(s.display) && s.overflowY==='visible' &&
        !(['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'].some(k=>px(s[k])>0)) &&
        (px(getComputedStyle(e.firstElementChild).marginTop)>0 || px(getComputedStyle(e.lastElementChild).marginBottom)>0)) return reject('marginCollapse');
    const rect=e.getBoundingClientRect();
    if (rect.width<55 || rect.height<9 || rect.height>100000) return reject('notMeasurable');
    const scroller=scrollParent(e),view=scrollView(scroller);
    if (view.height<30) return reject('hiddenScroller');
    const extent=scroller.scrollHeight-scroller.clientHeight;
    if (extent<view.height*.6) return reject('shortScroller');
    if(!activeScrollRoot || extent>activeScrollRoot.scrollHeight-activeScrollRoot.clientHeight)activeScrollRoot=scroller;
    const size=rect.height-['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'].reduce((sum,k)=>sum+px(s[k]),0);
    if (size<1 || !Number.isFinite(size)) return reject('unmeasurableBox');
    let depth=0;for(let p=e.parentElement;p;p=p.parentElement)depth++;
    cacheCandidate(e,scroller);
    return {e,scroller,size,depth};
  }
  function measure(roots) {return [...roots].map(e=>[e,e.scrollHeight,e.scrollTop]);}
  function movement(before) {return before.some(([e,height,top])=>Math.abs(e.scrollHeight-height)>4||Math.abs(e.scrollTop-top)>4);}
  function tryApply(batch) {
    const previous=measure(new Set(batch.map(x=>x.scroller)));
    for (const {e,size} of batch) {
      if (!originals.has(e)) originals.set(e,{had:e.style.getPropertyValue(SIZE)!=='',value:e.style.getPropertyValue(SIZE),priority:e.style.getPropertyPriority(SIZE)});
      e.style.setProperty(SIZE,`${size.toFixed(3)}px`);
      blockHeights.set(e,size);
      e.setAttribute(ATTR,'1');applied.add(e);
    }
    if (movement(previous)) {
      for (const {e} of batch) remove(e);
      return false;
    }
    for (const {e} of batch) io?.observe(e);
    return true;
  }
  function apply(batch) {
    if (!batch.length) return 0;
    if (tryApply(batch)) return batch.length;
    if (batch.length===1) {
      geometryRejected.add(batch[0].e);
      reasons.geometryRollback=(reasons.geometryRollback||0)+1;
      return 0;
    }
    const half=batch.length>>1;
    return apply(batch.slice(0,half))+apply(batch.slice(half));
  }
  function finish(summary,ms,workMs) {
    stats.scanMs=Math.round(ms*10)/10;stats.workMs=Math.round(workMs*10)/10;
    stats.scans++;stats.contained=applied.size;running=false;updateFar();
    if (!active()) stats.reason='Disabled';
    else if (stats.contained) stats.reason='Native containment enabled';
    else if (reasons.geometryRollback) stats.reason='Scroll geometry changed; unsafe containment reverted';
    else stats.reason='No safe offscreen blocks; see rejection diagnostics';
    stats.rejections=Object.fromEntries(Object.entries(reasons).sort((a,b)=>b[1]-a[1]).slice(0,7));stats.cachedRegions=[...regions.values()].reduce((a,m)=>a+m.size,0);if(stats.scanType==='full')stats.fullScans++;else stats.localScans++;
    stats.scrollRoot=summary;
    refreshOverlay();
  }
  function scan() {
    scheduled=0;
    if (!active() || running || !document.body) return;
    running=true;scrollableCache=new WeakMap();const id=++generation,start=stamp();
    const all=fullRescan;const scope=all?roots():[...dirtyRoots];
    dirtyRoots.clear();fullRescan=false;
    let workMs=0;
    for (const k of Object.keys(reasons)) delete reasons[k];
    let blocks;
    try { if (lastUrl!==location.href) {removeAll();lastUrl=location.href;fullRescan=true;}
      blocks=collect(scope);stats.scanType=all?'full':'local';stats.scanned=blocks.length;stats.eligible=0;stats.added=0;
      for (const e of applied) if(!e.isConnected || !e.hasAttribute(ATTR)){
          if(e.hasAttribute(FAR)) {farCount=Math.max(0,farCount-1);hiddenHeight=Math.max(0,hiddenHeight-(blockHeights.get(e)||0));}
          applied.delete(e);
        }
    } catch (err) {running=false;stats.reason=`Collection error: ${err?.name||'unknown'}`;refreshOverlay();return;}
    let i=0,selected=[],observedScroll=new Set();
    function step() {
      if (id!==generation||!active()) {running=false;return;}
      const slice=stamp();
      try {
        while (i<blocks.length && stamp()-slice<6) {
          const candidateNode=blocks[i++],c=candidate(candidateNode);
          if (c) {stats.eligible++;observedScroll.add(c.scroller);selected.push(c);}
        }
        workMs+=stamp()-slice;const afterCandidates=stamp();
        if (i<blocks.length) {setTimeout(step,0);return;}
        const priority=e=>e.tagName==='FIGURE'&&e.querySelector('img,picture,svg')?2:LEAF.has(e.tagName)?1:0;
        selected.sort((a,b)=>priority(b.e)-priority(a.e)||b.depth-a.depth);
        const limit=3000,batch=[];
        for (const c of selected) {
          if (applied.size+stats.added>=limit) break;
          let nested=false;
          for(let p=c.e.parentElement;p;p=p.parentElement) if(applied.has(p)) {nested=true;break;}
          if(nested) continue;
          if(batch.some(x=>x.e.contains(c.e)||c.e.contains(x.e))) continue;
          if(!LEAF.has(c.e.tagName) && (c.e.querySelector(`[${ATTR}]`) || batch.some(x=>c.e.contains(x.e)))) continue;
          batch.push(c);
          if (batch.length===32) {stats.added+=apply(batch);batch.length=0;}
        }
        if (batch.length) stats.added+=apply(batch);
        const any=observedScroll.values().next().value;
        const scroller=any || scrollerFromContent();
        const summary=rootLabel(scroller);
        totalScrollHeight=scroller?.scrollHeight||0;
        workMs+=stamp()-afterCandidates;finish(summary,stamp()-start,workMs);
      } catch(err) {running=false;stats.reason=`Scan error: ${err?.message||'unknown'}`;refreshOverlay();}
      if(!running && (fullRescan || dirtyRoots.size)) schedule(200);
      else if(!running && all && !applied.size && fullRetries++<3) {
        fullRescan=true;schedule(650*fullRetries);
      }
    }
    step();
  }
  function schedule(delay=400) {
    if (!active() || scheduled) return;
    scheduled=setTimeout(scan,delay);
  }

  function persistSettings() {
    GM_setValue('enabled', settings.enabled);
    GM_setValue('excludedHosts', settings.excludedHosts);
  }
  function reapplyAfterToggle() {
    if(!active()){cancel();removeAll();stats.reason='Disabled';refreshOverlay();return;}
    cancel();removeAll();observer();schedule(150);
  }
  function toggleEnabled() {
    settings.enabled=!settings.enabled;
    persistSettings();
    reapplyAfterToggle();
  }
  function toggleSite() {
    const h=host();
    const hosts=new Set(settings.excludedHosts);
    if(hosts.has(h)) hosts.delete(h);else hosts.add(h);
    settings.excludedHosts=[...hosts];
    persistSettings();
    reapplyAfterToggle();
  }

  // ---------- diagnóstico (shadow DOM, toggled pelo botão/menu) ----------
  const fmt = new Intl.NumberFormat('en-US');
  const n = v => Number.isFinite(v) ? fmt.format(Math.max(0,Math.round(v))) : '—';
  let overlayHost, panel, pollId;
  const siteExcluded = () => settings.excludedHosts.includes(host());

  const leafSvg = '<svg viewBox="0 0 128 128" aria-hidden="true"><rect width="128" height="128" rx="29" fill="#0d151c"/><path d="M32 89C30 54 49 34 102 25c0 46-22 75-59 72-4-11-5-25 0-37-7 10-11 20-11 29Z" fill="url(#gl)"/><path d="M25 106C33 77 51 55 83 42" fill="none" stroke="#53ff9b" stroke-width="6.5" stroke-linecap="round"/><path d="M39 83c10-18 24-30 44-41" fill="none" stroke="#073728" stroke-width="3.5" stroke-linecap="round"/><defs><linearGradient id="gl" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#1fe779"/><stop offset=".55" stop-color="#52fa98"/><stop offset="1" stop-color="#a4ffc4"/></linearGradient></defs></svg>';

  const overlayCss = `
    :host{all:initial}
    *{box-sizing:border-box;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .gdo-root{position:fixed;right:18px;bottom:18px;z-index:2147483646;color:#eef1f8;line-height:1.35}
    .fab{width:48px;height:48px;border:1px solid rgba(110,251,173,.35);border-radius:50%;background:radial-gradient(circle at 60% 40%,#18392c,#0d151c);box-shadow:0 6px 18px rgba(0,0,0,.45),0 0 14px rgba(47,244,123,.25);cursor:pointer;padding:7px;opacity:.88;transition:opacity .15s,transform .15s}
    .fab:hover,.fab:focus-visible{opacity:1;transform:translateY(-2px);outline:none}
    .fab svg{width:100%;height:100%;display:block}
    .panel{position:absolute;right:0;bottom:60px;width:330px;max-height:min(78vh,640px);overflow:auto;border:1px solid rgba(163,195,238,.29);border-radius:20px;padding:16px 15px 12px;background:radial-gradient(ellipse 220px 220px at 60% 30%,rgba(7,89,50,.20),transparent 95%),linear-gradient(155deg,rgba(33,43,58,.97),rgba(10,17,24,.985) 60%);box-shadow:0 22px 45px rgba(0,0,0,.6);backdrop-filter:blur(10px)}
    .panel[hidden]{display:none}
    header{display:flex;align-items:center;gap:9px;padding-right:30px}
    header .logo{width:38px;height:38px;flex:none}
    h1{margin:0;font-size:16px;letter-spacing:-.5px;font-weight:760;color:#f4f7fd;white-space:nowrap}
    h1 span{color:#57ed93}
    .tagline{margin-top:2px;color:#94a1b7;letter-spacing:1.7px;font-size:8px;font-weight:650}
    .close{position:absolute;top:10px;right:10px;width:26px;height:26px;border:1px solid rgba(163,195,238,.25);border-radius:8px;background:transparent;color:#aebdd0;font-size:15px;line-height:1;cursor:pointer}
    .close:hover,.close:focus-visible{color:#fff;border-color:#57ed93;outline:none}
    .hero{display:flex;justify-content:center;margin:12px 0 10px}
    .ring{--coverage:0%;position:relative;width:132px;height:132px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(from -90deg,#59ff9c 0%,#21f276 var(--coverage),rgba(100,125,136,.21) var(--coverage));box-shadow:0 0 16px rgba(40,227,102,.15)}
    .face{width:106px;height:106px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(155deg,#0b171b,#081112)}
    .percent{font-size:29px;font-weight:800;letter-spacing:-1px;color:#66ff9e;font-variant-numeric:tabular-nums}
    .ring-label{margin-top:2px;letter-spacing:1.6px;font-size:7px;color:#dbf3e7;text-align:center}
    .summary{display:flex;justify-content:space-around;border:1px solid rgba(149,176,207,.17);border-radius:14px;background:linear-gradient(132deg,rgba(26,37,48,.62),rgba(14,23,32,.6));padding:10px 6px;min-height:52px;align-items:center}
    .summary div{text-align:center}
    .micro{display:block;font-size:9px;color:#9caac1;white-space:nowrap}
    .summary strong{font-size:17px;font-variant-numeric:tabular-nums;color:#eef1f8}
    .summary strong.mint{color:#63ef9b}
    .divider{width:1px;height:30px;background:rgba(148,166,194,.19)}
    .control{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;padding:10px 12px;border:1px solid rgba(149,176,207,.17);border-radius:14px;background:linear-gradient(132deg,rgba(26,37,48,.62),rgba(14,23,32,.6))}
    .control h2{font-size:12px;margin:0 0 2px;color:#f4f7fd;letter-spacing:-.2px}
    .control p{margin:0;color:#93a2ba;font-size:9.5px}
    .switch{position:relative;display:block;width:46px;height:26px;flex:none;cursor:pointer}
    .switch input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}
    .track{width:46px;height:26px;border-radius:40px;display:block;background:#354152;border:1px solid rgba(205,219,242,.27);transition:.18s}
    .thumb{display:block;position:absolute;top:3px;left:3px;width:19px;height:19px;background:#f7fbff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.4);transition:transform .18s}
    .switch input:checked+.track{background:linear-gradient(105deg,#0db94b,#31ea78);border-color:#68ff9b}
    .switch input:checked+.track>.thumb{transform:translateX(20px)}
    .switch input:focus-visible+.track{outline:2px solid #eef;outline-offset:2px}
    .control.off{opacity:.6}
    .state{font-size:9px;color:#54ee8e;margin-top:2px}
    .control.off .state{color:#9faabd}
    .telemetry{padding:11px 2px 0}
    .telemetry-title{display:flex;justify-content:space-between;align-items:center;color:#7c8da7;letter-spacing:1.6px;font-size:8.5px;font-weight:740;margin:0 4px 7px}
    .live{display:flex;align-items:center;gap:5px;color:#56e897;letter-spacing:.6px;font-size:8.5px}
    .live i{width:5px;height:5px;border-radius:50%;background:#39ef7e;box-shadow:0 0 8px rgba(65,251,129,.6)}
    .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
    .stat{border:1px solid rgba(129,161,198,.13);border-radius:9px;background:rgba(13,27,34,.55);padding:7px 3px 6px;text-align:center}
    .stat span{font-size:8px;color:#8193aa;display:block;white-space:nowrap}
    .stat strong{display:block;margin-top:3px;font-size:12.5px;color:#e8f2f5;font-variant-numeric:tabular-nums;font-weight:650}
    .detail-row{display:flex;justify-content:space-between;gap:8px;margin:7px 4px 0;font-size:9px;color:#8192a9}
    .detail-row span:last-child{color:#a5b5c6;max-width:215px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;text-align:right}
    footer{display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:1px solid rgba(153,182,210,.1);margin-top:9px;padding:8px 3px 0;font-size:9px;color:#8fa2b4}
    footer .host{max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c3d4dd}
    footer .reason{max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
    @media (prefers-reduced-motion: reduce){*{transition:none !important}}
    @media print{:host{display:none !important}}
  `;

  try { if (window.CSS?.registerProperty) CSS.registerProperty({name:'--coverage',syntax:'<percentage>',inherits:false,initialValue:'0%'}); } catch (_) { /* propriedade opcional */ }

  function buildOverlay() {
    if (overlayHost) return;
    overlayHost = document.createElement('div');
    overlayHost.className = 'gdo-host';
    const shadow = overlayHost.attachShadow({mode:'open'});
    const style = document.createElement('style');
    style.textContent = overlayCss;
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="gdo-root">' +
        '<section class="panel" aria-label="Diagnóstico do Global DOM Optimizer" hidden>' +
          '<button class="close" aria-label="Fechar painel">×</button>' +
          '<header><div class="logo" aria-hidden="true">' + leafSvg + '</div><div><h1>DOM <span>Optimizer</span></h1><div class="tagline">A CLEANER, FASTER WEB</div></div></header>' +
          '<div class="hero"><div class="ring"><div class="face"><div class="percent">—</div><div class="ring-label">Skipped<br>height</div></div></div></div>' +
          '<div class="summary"><div><span class="micro">Hidden blocks</span><strong id="hidden">—</strong></div><div class="divider"></div><div><span class="micro">Managed blocks</span><strong class="mint" id="contained">—</strong></div></div>' +
          '<div class="control" id="powerRow"><div><h2>Global DOM Optimizer</h2><p>Hide non-viewable content</p><div class="state" data-role="powerState"></div></div><label class="switch" title="Toggle optimization"><input id="power" type="checkbox" aria-label="Enable Global DOM Optimizer"><span class="track"><span class="thumb"></span></span></label></div>' +
          '<div class="control" id="siteRow"><div><h2>Enable this website</h2><p>Optimize this site’s pages</p><div class="state" data-role="siteState"></div></div><label class="switch" title="Enable optimization on this website"><input id="siteEnabled" type="checkbox" aria-label="Enable this website"><span class="track"><span class="thumb"></span></span></label></div>' +
          '<div class="telemetry"><div class="telemetry-title"><span>LIVE DIAGNOSTICS</span><span class="live"><i></i>LIVE</span></div>' +
            '<div class="stats-grid">' +
              '<div class="stat"><span>Scans</span><strong data-s="scans">—</strong></div>' +
              '<div class="stat"><span>Scan work</span><strong data-s="scanMs">—</strong></div>' +
              '<div class="stat"><span>Grid tiles</span><strong data-s="tiles">—</strong></div>' +
              '<div class="stat"><span>Inspected</span><strong data-s="scanned">—</strong></div>' +
            '</div>' +
            '<div class="detail-row"><span>Full / scoped</span><span data-s="scanTypes">—</span></div>' +
            '<div class="detail-row"><span>Scroll root</span><span data-s="scrollRoot">—</span></div>' +
          '</div>' +
          '<footer><span class="host" id="hostEl"></span><span class="reason" id="reasonEl"></span></footer>' +
        '</section>' +
        '<button class="fab" aria-label="Global DOM Optimizer: abrir diagnóstico">' + leafSvg + '</button>' +
      '</div>';
    shadow.append(style, root);
    document.body.appendChild(overlayHost);

    panel = shadow.querySelector('.panel');
    const fab = shadow.querySelector('.fab');
    const closeBtn = shadow.querySelector('.close');
    const power = shadow.querySelector('#power');
    const siteEnabled = shadow.querySelector('#siteEnabled');

    const setOpen = open => {
      panel.hidden = !open;
      fab.setAttribute('aria-expanded', String(open));
      if (open) { pollId = setInterval(refreshOverlay, 1000); refreshOverlay(); }
      else if (pollId) { clearInterval(pollId); pollId = 0; }
    };
    fab.addEventListener('click', () => setOpen(panel.hidden));
    closeBtn.addEventListener('click', () => setOpen(false));
    power.addEventListener('change', () => toggleEnabled());
    siteEnabled.addEventListener('change', () => toggleSite());
    root._setOpen = setOpen;
    overlayHost._root = root;
  }

  function refreshOverlay() {
    if (!overlayHost || !pollId) return; // painel fechado: nada para pintar
    const shadow = overlayHost.shadowRoot;
    const on = active();
    const coverage = on ? Math.max(0,Math.min(100,Number(stats.coverage)||0)) : 0;
    shadow.querySelector('.ring').style.setProperty('--coverage', coverage + '%');
    shadow.querySelector('.percent').textContent = coverage + '%';
    const setTxt = (sel, txt) => { const el = shadow.querySelector(sel); if (el) el.textContent = txt; };
    const setStat = (key, txt) => setTxt(`[data-s="${key}"]`, txt);
    setTxt('#hidden', n(stats.far));
    setTxt('#contained', n(applied.size));
    setStat('scans', n(stats.scans));
    setStat('scanMs', Number.isFinite(stats.workMs) ? stats.workMs.toFixed(1) + 'ms' : '—');
    setStat('tiles', n(stats.cachedRegions));
    setStat('scanned', n(stats.scanned));
    setStat('scanTypes', `${n(stats.fullScans)} / ${n(stats.localScans)}`);
    const sr = stats.scrollRoot || '—';
    setStat('scrollRoot', sr);
    shadow.querySelector('[data-s="scrollRoot"]').title = sr;
    setTxt('#hostEl', host() || 'unknown');
    setTxt('#reasonEl', !settings.enabled ? 'Paused' : siteExcluded() ? 'Excluded' : stats.reason || 'Ready');
    const power = shadow.querySelector('#power');
    const siteEnabled = shadow.querySelector('#siteEnabled');
    power.checked = settings.enabled;
    siteEnabled.checked = !siteExcluded();
    shadow.querySelector('#powerRow').classList.toggle('off', !settings.enabled);
    shadow.querySelector('#siteRow').classList.toggle('off', siteExcluded());
    shadow.querySelector('[data-role="powerState"]').textContent = !settings.enabled ? 'Paused' : siteExcluded() ? 'Excluded' : 'Active';
    shadow.querySelector('[data-role="siteState"]').textContent = siteExcluded() ? 'Excluded' : settings.enabled ? 'Active' : 'Ready';
  }

  function toggleOverlay() {
    buildOverlay();
    const root = overlayHost._root;
    const showing = overlayHost.style.display !== 'none';
    overlayHost.style.display = showing ? 'none' : '';
    if (showing) root._setOpen(false);
  }

  GM_registerMenuCommand('Global DOM Optimizer: Pausar/Retomar', () => { toggleEnabled(); });
  GM_registerMenuCommand('Global DOM Optimizer: Excluir/Incluir este site', () => { toggleSite(); });
  GM_registerMenuCommand('Global DOM Optimizer: Mostrar/Ocultar interface', () => { toggleOverlay(); });

  function boot() {
    if (!document.body || !document.head) { document.addEventListener('DOMContentLoaded', boot, {once:true}); return; }
    buildOverlay();
    observer(); if (active()) schedule(150);

    watcher = new MutationObserver(records => {
      if (!active()) return;
      if(lastUrl!==location.href){lastUrl=location.href;removeAll();resetRegions();fullRescan=true;}
      let structural=false;
      const now=stamp();
      for (const r of records) {
        const target=r.target.nodeType===1?r.target:r.target.parentElement;
        if (!target?.isConnected) continue;
        let block=target.closest(LEAVES+',figure,div,section,article');
        for(let p=target,n=0;p&&n<20;p=p.parentElement,n++){
          if(applied.has(p)) {remove(p);block=p;break;}
        }
        if (r.type==='characterData') {
          if (block) {edited.set(block,now);dirtyRoots.add(block);structural=true;}
          continue;
        }
        let additions=false;
        for (const node of r.addedNodes) {
          if (node.nodeType!==1) continue;
          if (node.matches?.(CANDIDATES) || node.querySelector?.(CANDIDATES)) {
            dirtyRoots.add(node);additions=true;
          }
        }
        if (additions) structural=true;
        else if (block) {edited.set(block,now);dirtyRoots.add(block);structural=true;}
      }
      if (structural) scheduleLocalUpdate();
    });
    function scheduleLocalUpdate() {
      lastMutationAt=stamp();
      if(pendingRescan) return;
      const flush=()=>{
        const remaining=950-(stamp()-lastMutationAt);
        if(remaining>0){pendingRescan=setTimeout(flush,remaining);return;}
        pendingRescan=0;schedule(100);
      };
      pendingRescan=setTimeout(flush,950);
    }
    watcher.observe(document.body,{subtree:true,childList:true,characterData:true});
    addEventListener('scroll',onRegionScroll,{passive:true});
    addEventListener('resize',()=>{removeAll();resetRegions();fullRescan=true;schedule(450);},{passive:true});
    addEventListener('pageshow',()=>{fullRescan=true;schedule(350);});
    refreshOverlay();
  }
  boot();
})();
