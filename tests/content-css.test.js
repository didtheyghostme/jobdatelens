const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");

function getCssBlock(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `Missing CSS block for ${selector}`);

  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("badge text containers define line-height independent of page div resets", () => {
  [
    "#jobdatelens-badge .jdl-header",
    "#jobdatelens-badge .jdl-title",
    "#jobdatelens-badge .jdl-status",
    "#jobdatelens-badge .jdl-actions",
    "#jobdatelens-badge .jdl-body",
    "#jobdatelens-badge .jdl-row",
    "#jobdatelens-badge .jdl-label",
    "#jobdatelens-badge .jdl-value-wrap",
    "#jobdatelens-badge .jdl-value",
    "#jobdatelens-badge .jdl-helper",
    "#jobdatelens-badge .jdl-state",
    "#jobdatelens-badge .jdl-state-copy",
    "#jobdatelens-badge .jdl-state-message",
    "#jobdatelens-badge .jdl-state-helper"
  ].forEach((selector) => {
    assert.match(getCssBlock(selector), /line-height:\s*[^;]+;/, selector);
  });
});

test("badge row containers use explicit auto-height layout", () => {
  [
    "#jobdatelens-badge",
    "#jobdatelens-badge .jdl-header",
    "#jobdatelens-badge .jdl-title",
    "#jobdatelens-badge .jdl-status",
    "#jobdatelens-badge .jdl-actions",
    "#jobdatelens-badge .jdl-body",
    "#jobdatelens-badge .jdl-row",
    "#jobdatelens-badge .jdl-label",
    "#jobdatelens-badge .jdl-value-wrap",
    "#jobdatelens-badge .jdl-value",
    "#jobdatelens-badge .jdl-helper",
    "#jobdatelens-badge .jdl-state",
    "#jobdatelens-badge .jdl-state-copy",
    "#jobdatelens-badge .jdl-state-message",
    "#jobdatelens-badge .jdl-state-helper"
  ].forEach((selector) => {
    const block = getCssBlock(selector);

    assert.match(block, /height:\s*auto;/, selector);
    assert.match(block, /min-height:\s*0;/, selector);
    assert.match(block, /max-height:\s*none;/, selector);
  });
});

test("notice text containers define line-height independent of page div resets", () => {
  assert.match(getCssBlock("#jobdatelens-notice"), /line-height:\s*1\.35;/);
  assert.match(getCssBlock("#jobdatelens-notice > div"), /line-height:\s*1\.35;/);
  assert.match(getCssBlock("#jobdatelens-notice .jdl-notice-helper"), /line-height:\s*1\.35;/);
});

test("notice close button uses stable compact dimensions", () => {
  const block = getCssBlock("#jobdatelens-notice .jdl-notice-close");

  assert.match(block, /position:\s*absolute;/);
  assert.match(block, /width:\s*22px;/);
  assert.match(block, /height:\s*22px;/);
  assert.match(block, /line-height:\s*1;/);
});

test("loading spinner is indeterminate but respects reduced motion", () => {
  const block = getCssBlock("#jobdatelens-badge .jdl-spinner");

  assert.match(block, /border-radius:\s*50%;/);
  assert.match(block, /animation:\s*jdl-spin\s+700ms\s+linear\s+infinite;/);
  assert.match(css, /@keyframes\s+jdl-spin\s*{[\s\S]*?transform:\s*rotate\(360deg\);[\s\S]*?}/);
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{[\s\S]*?#jobdatelens-badge \.jdl-spinner\s*{[\s\S]*?animation:\s*none;/
  );
});

test("Retry uses isolated button styling with stable sizing", () => {
  const block = getCssBlock("#jobdatelens-badge .jdl-retry-button");

  assert.match(block, /width:\s*auto;/);
  assert.match(block, /height:\s*auto;/);
  assert.match(block, /min-height:\s*28px;/);
  assert.match(block, /line-height:\s*1\.3;/);
  assert.match(block, /cursor:\s*pointer;/);
});
