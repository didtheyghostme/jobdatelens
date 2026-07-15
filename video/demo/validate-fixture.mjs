import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {getFixtureDates, renderFixture} from "./fixture.mjs";

const require = createRequire(import.meta.url);
const jobDateLens = require("../../content.js");

const fixedNow = new Date(2026, 6, 15, 12, 0, 0);
const html = await renderFixture(fixedNow);
const scriptMatch = html.match(
  /<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/i,
);

assert.ok(scriptMatch, "fixture must contain a JobPosting JSON-LD script");
assert.ok(!html.includes("__DATE_POSTED__"), "posted-date placeholder must be replaced");
assert.ok(!html.includes("__VALID_THROUGH__"), "deadline placeholder must be replaced");

const jobPosting = JSON.parse(scriptMatch[1]);
const expectedDates = getFixtureDates(fixedNow);

assert.equal(jobPosting["@type"], "JobPosting");
assert.equal(jobPosting.title, "Software Engineer");
assert.equal(jobPosting.hiringOrganization.name, "Example Labs");
assert.equal(jobPosting.datePosted, expectedDates.posted);
assert.equal(jobPosting.validThrough, expectedDates.deadline);
assert.ok(new Date(jobPosting.validThrough) > new Date(jobPosting.datePosted));

const scanResult = jobDateLens.scanJsonLdTexts([scriptMatch[1]], {
  title: "Software Engineer | Example Labs",
  heading: "Software Engineer",
  visibleText: "Software Engineer Example Labs Singapore Hybrid Full-time",
});

assert.ok(scanResult.selected, "the production JobDateLens parser must select the fixture posting");

const model = jobDateLens.formatJobPosting(scanResult.selected, fixedNow);
const postedRow = model.dateRows.find((row) => row.key === "posted");
const deadlineRow = model.dateRows.find((row) => row.key === "deadline");

assert.equal(model.status.kind, "open");
assert.equal(postedRow?.helper, "posted 7 days ago (schema.org: datePosted)");
assert.equal(deadlineRow?.helper, "expires in 31 days (schema.org: validThrough)");

console.log(
  `Fixture valid with production parser: ${jobPosting.title} at ${jobPosting.hiringOrganization.name}, posted ${jobPosting.datePosted}, deadline ${jobPosting.validThrough}`,
);
