const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const jobDateLens = require("../content.js");

const fixturesDir = path.join(__dirname, "fixtures");

function readFixture(name) {
  return fs.readFileSync(path.join(fixturesDir, name), "utf8");
}

function firstMatch(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1].trim() : "";
}

function extractJsonLdScripts(html) {
  const scripts = [];
  const pattern = /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = pattern.exec(html)) !== null) {
    scripts.push(match[1].trim());
  }

  return scripts;
}

function pageContextFromHtml(html, overrides = {}) {
  const withoutScripts = html.replace(/<script\b[\s\S]*?<\/script>/gi, " ");
  const visibleText = withoutScripts.replace(/<[^>]+>/g, " ");

  return Object.assign(
    {
      title: firstMatch(html, /<title>([\s\S]*?)<\/title>/i),
      heading: firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g, " "),
      visibleText
    },
    overrides
  );
}

function scanFixture(name, contextOverrides) {
  const html = readFixture(name);
  return jobDateLens.scanJsonLdTexts(extractJsonLdScripts(html), pageContextFromHtml(html, contextOverrides));
}

test("finds a single JobPosting JSON-LD block", () => {
  const result = scanFixture("single-valid.html");
  const model = jobDateLens.formatJobPosting(result.selected, new Date(2026, 5, 18, 12));

  assert.equal(result.errors.length, 0);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.selected.title, "Senior Product Manager");
  assert.equal(result.selected.company, "Acme Analytics");
  assert.equal(result.selected.datePostedRaw, "2026-06-01");
  assert.equal(result.selected.validThroughRaw, "2026-07-31");
  assert.equal(model.status.kind, "open");
});

test("does not select anything without JSON-LD", () => {
  const result = scanFixture("no-jsonld.html");

  assert.equal(result.candidates.length, 0);
  assert.equal(result.selected, null);
});

test("ignores non-JobPosting JSON-LD", () => {
  const result = scanFixture("non-job-jsonld.html");

  assert.equal(result.candidates.length, 0);
  assert.equal(result.selected, null);
});

test("recognizes JSON-LD script type casing and parameters", () => {
  assert.equal(jobDateLens.isJsonLdType("application/ld+json"), true);
  assert.equal(jobDateLens.isJsonLdType("APPLICATION/LD+JSON"), true);
  assert.equal(jobDateLens.isJsonLdType("application/ld+json; charset=utf-8"), true);
  assert.equal(jobDateLens.isJsonLdType("application/json"), false);
});

test("handles array JSON-LD", () => {
  const result = scanFixture("array.html");

  assert.equal(result.candidates.length, 1);
  assert.equal(result.selected.title, "Data Analyst");
});

test("handles @graph JSON-LD", () => {
  const result = scanFixture("graph.html");

  assert.equal(result.candidates.length, 1);
  assert.equal(result.selected.title, "Platform Engineer");
});

test("selects the best matching JobPosting when multiple candidates exist", () => {
  const result = scanFixture("multiple.html");

  assert.equal(result.candidates.length, 2);
  assert.equal(result.selected.title, "Senior Product Manager");
  assert.equal(result.selected.company, "Acme Analytics");
});

test("records malformed JSON-LD errors without selecting a posting", () => {
  const result = scanFixture("malformed.html");

  assert.equal(result.errors.length, 1);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.selected, null);
});

test("surfaces missing datePosted as an explicit state", () => {
  const result = scanFixture("missing-datePosted.html");
  const model = jobDateLens.formatJobPosting(result.selected, new Date(2026, 5, 18, 12));

  assert.equal(result.candidates.length, 1);
  assert.equal(model.postedDate.state, "missing");
  assert.equal(model.status.kind, "warning");
  assert.equal(model.status.label, "Missing posted");
});

test("surfaces missing validThrough without treating the job as expired", () => {
  const result = scanFixture("missing-validThrough.html");
  const model = jobDateLens.formatJobPosting(result.selected, new Date(2026, 5, 18, 12));

  assert.equal(result.candidates.length, 1);
  assert.equal(model.validThrough.state, "missing");
  assert.equal(model.status.kind, "missing");
  assert.equal(model.status.label, "No expiry");
});

test("surfaces invalid date fields", () => {
  const result = scanFixture("invalid-dates.html");
  const model = jobDateLens.formatJobPosting(result.selected, new Date(2026, 5, 18, 12));

  assert.equal(model.postedDate.state, "invalid");
  assert.equal(model.validThrough.state, "invalid");
  assert.equal(model.status.kind, "warning");
  assert.equal(model.status.label, "Invalid date");
});

test("marks expired postings based on validThrough", () => {
  const result = scanFixture("expired.html");
  const model = jobDateLens.formatJobPosting(result.selected, new Date(2026, 5, 18, 12));

  assert.equal(model.status.kind, "expired");
  assert.equal(model.status.label, "Expired");
  assert.match(model.validThrough.helper, /expired/);
});

test("treats date-only validThrough as the end of the local day", () => {
  const dateInfo = jobDateLens.parseSchemaDate("2026-06-18", "validThrough");
  const result = scanFixture("single-valid.html");
  const selected = Object.assign({}, result.selected, { validThroughRaw: "2026-06-18" });
  const midday = jobDateLens.formatJobPosting(selected, new Date(2026, 5, 18, 12));
  const nextDay = jobDateLens.formatJobPosting(selected, new Date(2026, 5, 19, 0, 0, 1));

  assert.equal(dateInfo.state, "valid");
  assert.equal(dateInfo.date.getHours(), 23);
  assert.equal(dateInfo.date.getMinutes(), 59);
  assert.equal(dateInfo.date.getSeconds(), 59);
  assert.equal(dateInfo.date.getMilliseconds(), 999);
  assert.equal(midday.status.kind, "open");
  assert.equal(nextDay.status.kind, "expired");
});

test("fixture covers dynamically inserted JSON-LD payloads", () => {
  const html = readFixture("dynamic.html");
  const initialScripts = extractJsonLdScripts(html);
  const payload = firstMatch(html, /<script id="dynamic-json" type="application\/json">([\s\S]*?)<\/script>/i);
  const beforeInsert = jobDateLens.scanJsonLdTexts(initialScripts, pageContextFromHtml(html));
  const afterInsert = jobDateLens.scanJsonLdTexts([payload], pageContextFromHtml(html));

  assert.equal(beforeInsert.candidates.length, 0);
  assert.equal(afterInsert.candidates.length, 1);
  assert.equal(afterInsert.selected.title, "UX Researcher");
});
