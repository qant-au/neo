// End-to-end tests for code blocks (⌘⇧B, or ``` then Enter) and inline
// maths (⌘⇧M, or $…$): typed exactly, kept in the chapter file, and carried
// by every export. Run with `npm run test:code-math`.

'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const JSZip = require('jszip');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-cm-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-cm-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const lib = path.join(tmp, 'NEO Library');
fs.mkdirSync(lib);
fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, moreFeatures: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const MOD = process.platform === 'darwin' ? 'meta' : 'control';
const key = async (keyCode, modifiers = [], wait = 150) => {
  for (const type of ['keyDown', 'char', 'keyUp']) {
    if (type === 'char' && (modifiers.some((m) => m !== 'shift') || keyCode.length > 1)) continue;
    wc.sendInputEvent({ type, keyCode, modifiers });
  }
  await tick(wait);
};
// typed key by key, so NEO's typing rules (quotes, dashes, $) see every one
const typeKeys = async (text) => {
  for (const c of text) await key(c, c !== c.toLowerCase() || '~!@#$%^&*()_+{}|:"<>?'.includes(c) ? ['shift'] : [], 30);
  await tick(150);
};
const body0 = `document.querySelectorAll('.chapter-body')[0]`;
const html0 = () => js(`chapterHTML[book.chapterOrder[0]]`);
const caretAtEnd = (para) => js(`(() => {
  const p = ${body0}.children[${para}];
  const r = document.createRange();
  r.selectNodeContents(p);
  r.collapse(false);
  p.closest('.chapter-body').focus();
  getSelection().removeAllRanges();
  getSelection().addRange(r);
})()`);
const caretPara = () => js(`(() => { const p = caretBlock(${body0}); return p ? { cls: p.className, text: p.textContent, i: [...${body0}.children].indexOf(p) } : null; })()`);
const until = async (fn, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await tick(100); } throw new Error('timed out'); };
const OUT = process.env.NEO_OUT || path.join(tmp, 'out');
fs.mkdirSync(OUT, { recursive: true });
const saveTo = (name) => { const to = path.join(OUT, name); try { fs.unlinkSync(to); } catch { /* new */ } dialog.showSaveDialog = async () => ({ canceled: false, filePath: to }); return to; };
const exported = async (format, name) => {
  const to = saveTo(name);
  await js(`doExport(${JSON.stringify(format)})`);
  await until(() => fs.existsSync(to) && fs.statSync(to).size > 0, 120000);
  await tick(300);
  return to;
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('``` alone on a line, then Enter, opens a code line', async () => {
  await caretAtEnd(5);
  await key('Return');
  await typeKeys('```');
  await key('Return');
  const p = await caretPara();
  assert.equal(p.cls, 'code');
  assert.equal(p.text, '');
});

test('code is typed exactly: straight quotes, two hyphens, no capital', async () => {
  await typeKeys('const s = "it\'s -- fine";');
  const p = await caretPara();
  assert.equal(p.text, 'const s = "it\'s -- fine";');
});

test('Enter is the next line of code; leading spaces stay; no *** or chapter', async () => {
  const chapters = await js('book.chapterOrder.length');
  await key('Return');
  await key('Tab');
  await typeKeys('return s;');
  let p = await caretPara();
  assert.equal(p.cls, 'code');
  assert.equal(p.text, '  return s;');
  // a blank line inside the block: Enter mid-block, then back down
  await key('Return');
  await typeKeys('x');
  p = await caretPara();
  assert.equal(p.cls, 'code');
  assert.equal(await js('book.chapterOrder.length'), chapters);
  assert.equal(await js(`${body0}.querySelectorAll('p.scene-break').length`), 0);
});

test('Enter on the empty last line goes back to prose, and prose is typographic again', async () => {
  await key('Return');
  await key('Return');
  let p = await caretPara();
  assert.equal(p.cls, '');
  await typeKeys('She said "yes" -- then left.');
  p = await caretPara();
  assert.equal(p.text, 'She said “yes” — then left.');
});

test('the chapter file keeps the code lines as typed', async () => {
  await tick(1200);
  const html = await html0();
  assert.match(html, /<p class="code">const s = "it's -- fine";<\/p><p class="code"> {2}return s;<\/p><p class="code">x<\/p>/);
});

test('⌘⇧B at the end of a paragraph opens a code line beneath it; Esc goes back to prose', async () => {
  await caretAtEnd(0);
  await key('B', [MOD, 'shift']);
  let p = await caretPara();
  assert.equal(p.cls, 'code');
  assert.equal(p.i, 1);
  await typeKeys('ls -la');
  await key('Escape');
  p = await caretPara();
  assert.equal(p.cls, '');
  assert.equal(p.i, 2);
  assert.equal(await js(`${body0}.children[1].textContent`), 'ls -la');
  // that Esc was the block's: the book is still open, writing goes on
  assert.equal(await js("$('#editor-view').hidden"), false);
  await typeKeys('ok');
  assert.equal(await js(`${body0}.children[2].textContent`), 'Ok');
});

test('$…$ typed around a formula becomes inline maths, and writing goes on after it', async () => {
  await caretAtEnd(0);
  // the formula's own characters go in as text (^ is a dead key on some
  // layouts); the $ marks are real keys, which is what NEO reacts to
  await typeKeys(' Energy is $');
  wc.insertText('E = mc^2');
  await tick(100);
  await typeKeys('$ and more.');
  const m = await js(`[...${body0}.children[0].querySelectorAll('.math')].map((s) => s.textContent)`);
  assert.deepEqual(m, ['E = mc^2']);
  assert.match(await js(`${body0}.children[0].textContent`), /Energy is E = mc\^2 and more\.$/);
  assert.equal(await js(`${body0}.children[0].querySelector('.math').contentEditable`), 'false');
});

test('prices stay as typed: $5 and $10 is no formula', async () => {
  await typeKeys(' It cost $5 and $10.');
  assert.equal(await js(`${body0}.children[0].querySelectorAll('.math').length`), 1);
  assert.match(await js(`${body0}.children[0].textContent`), /It cost \$5 and \$10\.$/);
});

test('Backspace just after a formula opens it for editing; the closing $ sets it again', async () => {
  await js(`(() => {
    const span = ${body0}.children[0].querySelector('.math');
    caretPast(span);
  })()`);
  await key('Backspace');
  assert.equal(await js(`${body0}.children[0].querySelectorAll('.math').length`), 0);
  assert.match(await js(`${body0}.children[0].textContent`), /Energy is \$E = mc\^2 and more/);
  await typeKeys('+1$');
  assert.deepEqual(await js(`[...${body0}.children[0].querySelectorAll('.math')].map((s) => s.textContent)`), ['E = mc^2+1']);
});

test('maths shows typeset, centred on its own line, unshaded; code sits in the margins unshaded', async () => {
  const look = await js(`(() => {
    const span = ${body0}.children[0].querySelector('.math');
    const cs = getComputedStyle(span);
    const p = span.closest('p');
    const code = ${body0}.querySelector('p.code');
    const cc = getComputedStyle(code);
    return {
      wide: Math.round(span.getBoundingClientRect().width - p.getBoundingClientRect().width),
      math: !!(span.shadowRoot && span.shadowRoot.querySelector('math msup')),
      display: cs.display, align: cs.textAlign, bg: cs.backgroundColor,
      codeBg: cc.backgroundColor, codePad: cc.paddingLeft + ' ' + cc.paddingRight,
      codeLeft: Math.round(code.getBoundingClientRect().left - p.getBoundingClientRect().left),
      codeWidth: Math.round(code.getBoundingClientRect().width - p.getBoundingClientRect().width)
    };
  })()`);
  assert.equal(look.math, true);
  assert.equal(look.display, 'inline-block');
  assert.equal(look.wide, 0);
  assert.equal(look.align, 'center');
  assert.equal(look.bg, 'rgba(0, 0, 0, 0)');
  assert.equal(look.codeBg, 'rgba(0, 0, 0, 0)');
  assert.equal(look.codePad, '0px 0px');
  assert.equal(look.codeLeft, 0);
  assert.equal(look.codeWidth, 0);
});

test('⌘⇧M over a selection makes it maths', async () => {
  await js(`(() => {
    const p = ${body0}.children[2];
    p.textContent = 'Take x^2 + y^2 then stop.';
    const tn = p.firstChild;
    const r = document.createRange();
    r.setStart(tn, 5); r.setEnd(tn, 14);
    p.closest('.chapter-body').focus();
    getSelection().removeAllRanges(); getSelection().addRange(r);
  })()`);
  await key('M', [MOD, 'shift']);
  assert.deepEqual(await js(`[...${body0}.children[2].querySelectorAll('.math')].map((s) => s.textContent)`), ['x^2 + y^2']);
  await tick(1200);
  assert.match(await html0(), /<span class="math" contenteditable="false">x\^2 \+ y\^2<\/span>/);
});

test('maths counts no words', async () => {
  const n = await js(`countWords(chapterText(book.chapterOrder[0]))`);
  await js(`${body0}.children[2].querySelector('.math').remove(); syncChapter(${body0}, book.chapterOrder[0])`);
  assert.equal(await js(`countWords(chapterText(book.chapterOrder[0]))`), n);
});

test('Markdown export: a fenced block and $…$', async () => {
  const md = fs.readFileSync(await exported('md', 'cm.md'), 'utf8');
  assert.match(md, /```\nconst s = "it's -- fine";\n {2}return s;\nx\n```/);
  assert.match(md, /```\nls -la\n```/);
  assert.match(md, /\$E = mc\^2\+1\$/);
});

test('plain text export: code indented line by line, maths in $', async () => {
  const txt = fs.readFileSync(await exported('txt', 'cm.txt'), 'utf8');
  assert.match(txt, / {4}const s = "it's -- fine";\n {6}return s;\n {4}x\n/);
  assert.match(txt, /\$E = mc\^2\+1\$/);
});

test('Web Page export: code lines unshaded, maths typeset', async () => {
  const html = fs.readFileSync(await exported('html', 'cm.html'), 'utf8');
  assert.match(html, /<p class="code"> {2}return s;<\/p>/);
  assert.match(html, /<math display="block"[^>]*>.*<msup><mi>c<\/mi><mn[^>]*>2<\/mn><\/msup>/);
  assert.doesNotMatch(html, /class="math"/);
  assert.match(html, /p\.code \{ font-family: ui-monospace/);
  assert.doesNotMatch(html, /p\.code \{[^}]*background/);
});

test('Word export: the Code style and maths runs', async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(await exported('docx', 'cm.docx')));
  const doc = await zip.file('word/document.xml').async('string');
  const styles = await zip.file('word/styles.xml').async('string');
  assert.match(doc, /<w:pStyle w:val="Code"\/><\/w:pPr><w:r><w:t xml:space="preserve"> {2}return s;<\/w:t>/);
  // the formula a Word equation, centred on its own line
  assert.match(doc, /<w:jc w:val="center"\/><\/w:pPr><m:oMathPara><m:oMath>.*<m:sSup><m:e><m:r><m:t xml:space="preserve">c<\/m:t>/);
  assert.match(doc, /xmlns:m="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/math"/);
  assert.match(styles, /w:styleId="Code"/);
  // the code lines sit at the margin, as on the page
  assert.doesNotMatch(styles.match(/<w:style [^>]*w:styleId="Code".*?<\/w:style>/)[0], /w:ind/);
});

test('EPUB export: code lines and maths', async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(await exported('epub', 'cm.epub')));
  const names = Object.keys(zip.files).filter((n) => /\.xhtml$/.test(n));
  let all = '';
  for (const n of names) all += await zip.file(n).async('string');
  assert.match(all, /<p class="code"> {2}return s;<\/p>/);
  assert.match(all, /<math xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML" display="block"[^>]*>.*<msup><mi>c<\/mi>/);
  const opf = await zip.file(Object.keys(zip.files).find((n) => /\.opf$/.test(n))).async('string');
  assert.match(opf, /properties="mathml"/);
});

test('Manuscript Format: code in Courier at the margin, maths set (Word and PDF)', async () => {
  const D = `document.getElementById('manuscript-dialog')`;
  const to = saveTo('cm-ms.docx');
  await js(`(() => { window.__ms = doExport('manuscript'); })()`);
  await until(() => js(`!!${D}`));
  await js(`${D}.querySelector('.ms-docx').click()`);
  await until(() => fs.existsSync(to) && fs.statSync(to).size > 0);
  await tick(300);
  const zip = await JSZip.loadAsync(fs.readFileSync(to));
  const doc = await zip.file('word/document.xml').async('string');
  assert.match(doc, /<w:pStyle w:val="Code"\/><\/w:pPr><w:r><w:t xml:space="preserve"> {2}return s;<\/w:t>/);
  assert.match(doc, /<m:oMathPara><m:oMath>/);
  assert.doesNotMatch(doc, /\$E = mc/);
  const html = await js(`NeoManuscript.html(manuscriptModel(manuscriptDefaults(), manuscriptSections()))`);
  assert.match(html, /<p class="code"> {2}return s;<\/p>/);
  assert.match(html, /<math display="block"/);
});

test('Paperback pages: code lines marked for the space around them, maths set', async () => {
  const pb = await js(`buildPrintHtml(bookExportData(), { trim: '5.5x8.5', paper: 'cream', links: {}, alsoByText: '', reviewText: '', reviewWords: '' })`);
  assert.match(pb, /<p class="code top">const s/);
  assert.match(pb, /<p class="code end">x<\/p>/);
  assert.match(pb, /<math display="block"/);
  assert.doesNotMatch(pb, /class="math"/);
});

test('PDF export finishes', async () => {
  const to = await exported('pdf', 'cm.pdf');
  assert.ok(fs.statSync(to).size > 1000);
});

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      const paras = (s) => Array.from({ length: 6 }, () => ({ text: s }));
      await addImportedBooks([{ name: 'The Lantern Year', chapters: [
        { title: 'The Weigh Station', paras: paras('The scale was older than the road.') },
        { title: 'Salt Road', paras: paras('The convoy left at dawn and did not stop until the river.') }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await tick(400);
    win.focus();
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.message).replace(/\n/g, '\n     '));
      }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    app.exit(failed ? 1 : 0);
  }
}
main();
