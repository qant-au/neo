'use strict';

/* ================================================================== */
/*  CODE BLOCKS — ⌘⇧B (Ctrl+Shift+B), or ``` then Enter               */
/*  Lines of code between the prose, set monospaced with every space   */
/*  kept: no curly quotes, dashes, capitals or Markdown in them. Each  */
/*  line is a p.code, and a run of them reads as one block. Enter is   */
/*  the next line; Enter on an empty last line, Esc or ⌘⇧B goes back   */
/*  to prose; Backspace at the block's start makes that line prose.    */
/*  INLINE MATHS — ⌘⇧M (Ctrl+Shift+M), or $…$                         */
/*  LaTeX kept exactly as typed, in a span.math the caret steps over   */
/*  whole (like a footnote's number). The closing $ sets it; Backspace */
/*  just after it, a click on it or ⌘⇧M opens it again as $… to edit.  */
/* ================================================================== */

const KCODE = K('⌘⇧B', 'Ctrl+Shift+B');
const KMATH = K('⌘⇧M', 'Ctrl+Shift+M');
// a fence typed alone on a line: ``` (or ```js; the language is dropped)
const CODE_FENCE = /^\s*```[\w+#.-]*\s*$/;
const isCode = (p) => !!(p && p.classList && p.classList.contains('code'));
// the caret's paragraph is a line of code, or the caret sits in a maths span
function caretInCode(node) {
  const el = node && (node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
  return !!(el && el.closest && el.closest('p.code, .math'));
}

// a paragraph made a line of code: no poetry italic, flush, alignment
function makeCodeLine(p) {
  if (p.classList.contains('poetry')) romanize(p);
  p.classList.remove('poetry', 'flush', 'litrpg');
  p.removeAttribute('style');
  p.classList.add('code');
  if (p.textContent === '' && !p.querySelector('br')) p.innerHTML = '<br>';
}
// the last line of the code block p is in
function codeBlockEnd(p) {
  while (isCode(p.nextElementSibling)) p = p.nextElementSibling;
  return p;
}
// back to prose below the block: the empty paragraph after it, or a new one
function exitCodeBelow(block, body, chId) {
  snapshotStructure('leave code block');
  const end = codeBlockEnd(block);
  let next = end.nextElementSibling;
  if (!(next && next.tagName === 'P' && !isCode(next) && !next.classList.contains('scene-break') && next.textContent.trim() === '')) {
    next = document.createElement('p');
    next.innerHTML = '<br>';
    end.after(next);
  }
  placeCaret(next, 0);
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
}
function codeLineToProse(block, body, chId) {
  snapshotStructure('code line to prose');
  block.classList.remove('code');
  if (!block.className) block.removeAttribute('class');
  placeCaret(block, 0);
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
}

// The keys inside a line of code. Enter (and ⇧Enter) is the next line, so
// the double and triple Enter never make a *** or a chapter here.
function handleCode(e, body, chId) {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const block = caretBlock(body);
  if (!isCode(block)) return false;
  if (e.key === 'Enter') {
    e.preventDefault();
    enterRun = 0;
    if (!sel.isCollapsed) document.execCommand('delete');
    // Enter on an empty last line: that line is prose again
    if (block.textContent === '' && !isCode(block.nextElementSibling)) {
      codeLineToProse(block, body, chId);
      return true;
    }
    document.execCommand('insertParagraph');
    const cur = caretBlock(body);
    if (cur && !isCode(cur)) cur.classList.add('code');
    syncChapter(body, chId);
    return true;
  }
  if (e.key === 'Escape' && !vimEnabled) {
    // this Esc is the code block's: it must not go on to the page-wide
    // Esc, which leaves the book for the shelf
    e.preventDefault();
    e.stopPropagation();
    exitCodeBelow(block, body, chId);
    return true;
  }
  // Tab indents with two plain spaces (prose's Tab sets em spaces);
  // ⇧Tab takes back up to two before the caret
  if (e.key === 'Tab') {
    e.preventDefault();
    if (!e.shiftKey) { document.execCommand('insertText', false, '  '); return true; }
    const r = sel.getRangeAt(0);
    const node = r.startContainer;
    if (sel.isCollapsed && node.nodeType === Node.TEXT_NODE) {
      let n = 0;
      while (n < 2 && r.startOffset - n > 0 && node.data[r.startOffset - n - 1] === ' ') n++;
      if (n) {
        const del = document.createRange();
        del.setStart(node, r.startOffset - n);
        del.setEnd(node, r.startOffset);
        sel.removeAllRanges();
        sel.addRange(del);
        document.execCommand('delete');
      }
    }
    return true;
  }
  // Backspace at the start of the block's first line: that line is prose
  if (e.key === 'Backspace' && sel.isCollapsed && !isCode(block.previousElementSibling)) {
    const r = sel.getRangeAt(0);
    const head = document.createRange();
    head.selectNodeContents(block);
    try { head.setEnd(r.startContainer, r.startOffset); } catch { return false; }
    if (head.toString().length !== 0) return false;
    e.preventDefault();
    codeLineToProse(block, body, chId);
    return true;
  }
  return false;
}

// ``` alone on a line, then Enter: that line opens a code block
function codeFenceEnter(e, body, chId) {
  if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
  if (markdownOff() || !featureOn('codeMaths')) return false;
  const block = caretBlock(body);
  if (!block || isCode(block) || block.classList.contains('scene-break') || !CODE_FENCE.test(block.textContent)) return false;
  e.preventDefault();
  enterRun = 0;
  snapshotStructure('code block');
  block.innerHTML = '<br>';
  makeCodeLine(block);
  placeCaret(block, 0);
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
  return true;
}

// ⌘⇧B (Ctrl+Shift+B). In prose, the way ⌘⇧Enter makes poetry: at a
// paragraph's end a code line opens beneath it, mid-paragraph the text after
// the caret becomes one, and an empty paragraph (or the caret at its start)
// turns into one. Over a selection, every paragraph it touches turns to code
// or, when all of them are code already, back to prose. In code: back to prose.
function toggleCode() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  if (!body || isScript()) { toast(t('Click into a chapter first, then {key} starts a code block', { key: KCODE })); return; }
  const chId = body.closest('.chapter').dataset.id;
  currentChapterId = chId;
  const r = sel.getRangeAt(0);
  if (!sel.isCollapsed) {
    const ps = [...body.querySelectorAll(':scope > p')].filter((p) => r.intersectsNode(p) && !p.classList.contains('scene-break') && !p.classList.contains('ghost'));
    if (!ps.length) return;
    snapshotStructure('code block');
    const on = !ps.every(isCode);
    for (const p of ps) {
      if (on) makeCodeLine(p);
      else { p.classList.remove('code'); if (!p.className) p.removeAttribute('class'); }
    }
    placeCaret(ps[0], 0);
    syncChapter(body, chId);
    resetNativeUndo();
    breakRun++;
    return;
  }
  const block = caretBlock(body);
  if (!block || block.classList.contains('scene-break') || block.classList.contains('ghost')) return;
  if (isCode(block)) { exitCodeBelow(block, body, chId); return; }
  snapshotStructure('code block');
  const tail = document.createRange();
  tail.selectNodeContents(block);
  try { tail.setStart(r.startContainer, r.startOffset); } catch { return; }
  const after = tail.toString();
  if (block.textContent.trim() === '' || after.length === block.textContent.length) {
    makeCodeLine(block);
    placeCaret(block, 0);
  } else {
    const line = document.createElement('p');
    if (after !== '') {
      line.appendChild(tail.extractContents());
      for (const junk of line.querySelectorAll('br')) junk.remove();
      if (!block.textContent.trim()) block.innerHTML = '<br>';
    }
    makeCodeLine(line);
    block.after(line);
    placeCaret(line, 0);
  }
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
}

// Pasted into a line of code, text goes in as it was: one line of code per
// line, blank lines and leading spaces kept, nothing made typographic.
function pasteIntoCode(body, chId, text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  lines.forEach((line, i) => {
    if (i > 0) {
      document.execCommand('insertParagraph');
      const cur = caretBlock(body);
      if (cur && !isCode(cur)) cur.classList.add('code');
    }
    if (line) document.execCommand('insertText', false, line);
  });
  syncChapter(body, chId);
}

function mathSpan(tex) {
  const span = document.createElement('span');
  span.className = 'math';
  span.contentEditable = 'false';
  span.textContent = tex;
  return span;
}
// A formula set as maths: AsciiMath as typed (sum_(k=1)^n k), or LaTeX
// when it has a backslash in it (\frac{a}{b}), made MathML, which the
// engine draws itself. null when it can't be read: it shows as typed.
let asciiMath = null;
function mathMarkup(src, xml = false) {
  try {
    const tex = src.includes('\\') ? src : (asciiMath || (asciiMath = new AsciiMathParser())).parse(src);
    const out = temml.renderToString(tex, { displayMode: true, xml });
    return out.includes('temml-error') ? null : out;
  } catch {
    return null;
  }
}
// On the page the span keeps the formula as its text (what's saved, counted
// and exported), and shows it set, on a line of its own, from a shadow root.
// Every span that lands on the page is set, however it got there: typed,
// opened from a file, put back by ⌘Z.
const MATH_SHEET = new CSSStyleSheet();
MATH_SHEET.replaceSync(`.box { display: inline-block; width: 100%; text-align: center; text-indent: 0; margin: 0.45em 0; vertical-align: middle; }
.gap { display: inline-block; width: 2em; text-indent: 0; }
.gap.cap { width: auto; height: 0; overflow: hidden; visibility: hidden; vertical-align: baseline; font-size: 3.4em; line-height: 0.8; padding-right: 8px; font-family: var(--dropcap-font); }
.gap.cap::before { content: attr(data-cap); }
.gap[hidden], :host-context(p.flush) .gap, :host-context(p.poetry) .gap, :host-context(p[style*="text-align"]) .gap { display: none; }
math { font-family: "STIX Two Math", "Cambria Math", "Latin Modern Math", "Noto Sans Math", "STIX Math", math; font-size: 1.1em; text-indent: 0; }
.raw { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: 0.82em; white-space: pre-wrap; }`);
function typesetMath(span) {
  const root = span.shadowRoot || span.attachShadow({ mode: 'open' });
  const tex = span.textContent;
  if (root.tex === tex) return;
  root.tex = tex;
  root.adoptedStyleSheets = [MATH_SHEET];
  root.innerHTML = `<span class="box">${mathMarkup(tex) || `<span class="raw">${escHtml(tex)}</span>`}</span><span class="gap"></span>`;
  mathGap(span);
}
// the paragraphs the drop cap is set in (the ::before rule in styles.css)
const CAP_P = 'body:not(.no-dropcap) .chapter-body.has-cap:not(.no-cap):not(.opens-dialogue) p[data-first]';
// the letters the drop cap takes: any punctuation in front, then the letter
const capLetter = (text) => ((text || '').match(/^\s*([\p{P}]*[^\s\p{P}])/u) || [])[1] || '';
// the gap that sets the words after a formula in at the indent opens only
// when words follow it: at the end of a paragraph it would be a line of its
// own. In the paragraph with the drop cap, the indent is where its first
// lines start, beside the letter: the gap is a hidden copy of the drop cap,
// so it is exactly as wide, whatever the letter.
function mathGap(span) {
  const gap = span.shadowRoot && span.shadowRoot.querySelector('.gap');
  if (!gap) return;
  let words = false;
  for (let n = span.nextSibling; n && !words; n = n.nextSibling) {
    if (n.nodeType === Node.TEXT_NODE) words = /\S/.test(n.data);
    else if (n.nodeName === 'BR') break;
    else words = !!n.textContent || (n.classList && n.classList.contains('fn'));
  }
  gap.hidden = !words;
  const p = span.closest('p');
  const cap = p && p.matches(CAP_P) ? capLetter(p.textContent) : '';
  gap.classList.toggle('cap', !!cap);
  if (cap) gap.dataset.cap = cap;
  // the space typed after the formula starts that line too: the gap gives
  // its width back, so the first word sits on the indent exactly
  let t = span.nextSibling;
  while (t && t.nodeType === Node.TEXT_NODE && t.data === '') t = t.nextSibling;
  const n = words && t && t.nodeType === Node.TEXT_NODE ? t.data.match(/^[ \t]*/)[0].length : 0;
  let sp = 0;
  if (n) { const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, n); sp = r.getBoundingClientRect().width; }
  gap.style.marginRight = sp ? `-${sp}px` : '';
}
const mathGapsIn = (p) => { if (p) for (const s of p.getElementsByClassName('math')) mathGap(s); };
// where the opening paragraph's words start beside its drop cap, in ems of
// the prose, for a code block set straight after it (styles.css, --cap-in)
function capIndent(body) {
  const p = body && body.querySelector('p[data-first]');
  const next = p && p.nextElementSibling;
  if (!next || !next.classList.contains('code') || !p.matches(CAP_P)) { if (body) body.style.removeProperty('--cap-in'); return; }
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  const t = w.nextNode();
  const cap = capLetter(p.textContent);
  const at = t ? t.data.indexOf(cap) + cap.length : -1;
  if (!cap || at < cap.length || at >= t.data.length) { body.style.removeProperty('--cap-in'); return; }
  const r = document.createRange(); r.setStart(t, at); r.setEnd(t, at + 1);
  const em = parseFloat(getComputedStyle(p).fontSize);
  body.style.setProperty('--cap-in', ((r.getBoundingClientRect().left - p.getBoundingClientRect().left) / em).toFixed(3));
}
const capIndents = () => { for (const b of document.querySelectorAll('.chapter-body')) capIndent(b); };
if (document.fonts) document.fonts.addEventListener('loadingdone', capIndents);
new MutationObserver((list) => {
  for (const m of list) {
    // the drop cap set or taken off: the opening paragraphs' gaps follow it
    const inBody = m.target.nodeType === Node.ELEMENT_NODE ? m.target.closest('.chapter-body') : m.target.parentNode && m.target.parentNode.closest && m.target.parentNode.closest('.chapter-body');
    if (inBody) capIndent(inBody);
    else if (m.type === 'attributes' && m.target === document.body) capIndents();
    if (m.type === 'attributes') {
      const t = m.target;
      if (t.nodeName === 'P') mathGapsIn(t);
      else if (t === document.body || t.classList.contains('chapter-body')) for (const q of t.querySelectorAll('p[data-first]')) mathGapsIn(q);
      continue;
    }
    if (m.type === 'characterData') { mathGapsIn(m.target.parentNode && m.target.parentNode.closest && m.target.parentNode.closest('p')); continue; }
    for (const n of m.addedNodes) {
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      if (n.classList.contains('math')) typesetMath(n);
      else if (n.firstElementChild) for (const s of n.getElementsByClassName('math')) typesetMath(s);
    }
    if (m.target.nodeType === Node.ELEMENT_NODE) mathGapsIn(m.target.closest('p'));
  }
}).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-first'] });
// the caret on the far side of an atom (a maths span, a footnote's number):
// in the text that follows it, made if there's none, so typing goes there
function caretPast(atom) {
  let next = atom.nextSibling;
  if (!next || next.nodeType !== Node.TEXT_NODE) {
    next = document.createTextNode('');
    atom.after(next);
  }
  placeCaret(next, 0);
}
// the maths span just behind a collapsed caret, if any
function mathBeforeCaret(sel) {
  if (!sel.rangeCount || !sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  const node = r.startContainer;
  let prev;
  if (node.nodeType === Node.TEXT_NODE) {
    if (r.startOffset > 0) return null;
    prev = node.previousSibling;
    // past an empty text node or two
    while (prev && prev.nodeType === Node.TEXT_NODE && prev.data === '') prev = prev.previousSibling;
  } else {
    prev = node.childNodes[r.startOffset - 1];
  }
  return prev && prev.nodeType === Node.ELEMENT_NODE && prev.classList.contains('math') ? prev : null;
}
// A maths span opened for editing: it goes back to its text, $ in front,
// so the closing $ sets it again (the caller puts the caret).
let mathOpen = null; // the paragraph holding a $ opened this way, for the closing $
function openMath(span, body, chId) {
  snapshotStructure('edit maths');
  const p = span.closest('p');
  span.replaceWith(document.createTextNode('$' + span.textContent));
  p.normalize();
  mathOpen = p;
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
}

// The $ that closes $…$: the LaTeX between the marks becomes a maths span.
// Only where the marks hug the formula ($x$, $a + b$), so prices like $5 or
// $10 stay as typed: the closing $ needs no space before it, and the opening
// one no space after it and no letter or digit before it.
const MATH_CLOSE = /(^|[^\\$\p{L}\p{N}])\$(?![\s$])([^$]*?[^\s\\$])$/u;
function markdownMath(e, body, range) {
  if (e.key !== '$' || !range.collapsed) return false;
  if (!body.matches || !body.matches('.chapter-body')) return false;
  const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  const block = start && start.closest('p');
  if (!block || !body.contains(block) || isCode(block) || block.closest('.math')) return false;
  if ((markdownOff() || !featureOn('codeMaths')) && mathOpen !== block) return false;
  const pre = document.createRange();
  pre.setStart(block, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const before = pre.toString();
  const m = before.match(MATH_CLOSE);
  if (!m) return false;
  e.preventDefault();
  mathOpen = null;
  const chId = body.closest('.chapter').dataset.id;
  snapshotStructure('maths');
  const at = before.length - m[0].length + m[1].length; // where the opening $ sits
  selectChars(block, at, before.length);
  const sel = window.getSelection();
  const r = sel.getRangeAt(0);
  r.deleteContents();
  const span = mathSpan(m[2]);
  r.insertNode(span);
  syncChapter(body, chId);
  resetNativeUndo();
  // after the reset: put back by character count, the caret would land
  // inside the formula, where nothing can be typed
  caretPast(span);
  breakRun++;
  return true;
}

// ⌘⇧M (Ctrl+Shift+M): the selected words become maths; just past a maths
// span, it opens for editing; otherwise a $ goes in, and the closing $ that
// follows sets the formula (even with Markdown typing turned off).
function insertMath() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  const p = body && el.closest('.chapter-body > p');
  if (!body || !p || isScript() || isCode(p) || p.classList.contains('scene-break') || p.classList.contains('ghost')) {
    toast(t('Click into a chapter first, then {key} adds maths', { key: KMATH }));
    return;
  }
  const chId = body.closest('.chapter').dataset.id;
  currentChapterId = chId;
  const r = sel.getRangeAt(0);
  if (!sel.isCollapsed) {
    const tex = r.toString().replace(/\s+/g, ' ').trim();
    if (!tex || !p.contains(r.endContainer)) return;
    snapshotStructure('maths');
    r.deleteContents();
    const span = mathSpan(tex);
    r.insertNode(span);
    syncChapter(body, chId);
    resetNativeUndo();
    // after the reset: put back by character count, the caret would land
    // inside the formula, where nothing can be typed
    caretPast(span);
    breakRun++;
    return;
  }
  const behind = mathBeforeCaret(sel);
  if (behind) { openMathAtEnd(behind, body, chId); return; }
  document.execCommand('insertText', false, '$');
  mathOpen = p;
}
// open a maths span for editing, the caret just after its last character
function openMathAtEnd(span, body, chId) {
  const p = span.closest('p');
  const pre = document.createRange();
  pre.setStart(p, 0);
  pre.setEndBefore(span);
  const at = pre.toString().length + 1 + span.textContent.length; // past the $ and the formula
  openMath(span, body, chId);
  selectChars(p, at, at);
}
// Backspace just past a maths span opens it, rather than deleting the formula
function mathBackspace(e, body, chId) {
  if (e.key !== 'Backspace' || e.metaKey || e.ctrlKey || e.altKey) return false;
  const span = mathBeforeCaret(window.getSelection());
  if (!span || !body.contains(span)) return false;
  e.preventDefault();
  openMathAtEnd(span, body, chId);
  return true;
}
