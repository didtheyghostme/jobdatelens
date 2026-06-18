const assert = require("node:assert/strict");
const test = require("node:test");

const jobDateLens = require("../content.js");

const defaultContext = {
  title: "Senior Product Manager at Acme Analytics",
  heading: "Senior Product Manager",
  visibleText: "Senior Product Manager Acme Analytics is hiring."
};

function scan(jsonLdTexts, context = defaultContext) {
  return jobDateLens.scanJsonLdTexts(
    Array.isArray(jsonLdTexts) ? jsonLdTexts : [jsonLdTexts],
    context
  );
}

function json(value) {
  return JSON.stringify(value);
}

function jobPosting(overrides = {}) {
  return Object.assign(
    {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Senior Product Manager",
      datePosted: "2026-06-01",
      validThrough: "2026-07-31",
      hiringOrganization: {
        "@type": "Organization",
        name: "Acme Analytics"
      }
    },
    overrides
  );
}

test("finds a single JobPosting JSON-LD block", () => {
  const result = scan(json(jobPosting()));
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
  const result = scan([]);

  assert.equal(result.candidates.length, 0);
  assert.equal(result.selected, null);
});

test("ignores non-JobPosting JSON-LD", () => {
  const result = scan(
    json({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Acme Analytics"
    })
  );

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
  const result = scan(
    json([
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        name: "Careers"
      },
      jobPosting({
        title: "Data Analyst",
        datePosted: "2026-05-20",
        validThrough: "2026-08-01T17:00:00+08:00",
        hiringOrganization: {
          "@type": "Organization",
          name: "Northstar Labs"
        }
      })
    ]),
    {
      title: "Data Analyst at Northstar Labs",
      heading: "Data Analyst",
      visibleText: "Data Analyst Northstar Labs"
    }
  );

  assert.equal(result.candidates.length, 1);
  assert.equal(result.selected.title, "Data Analyst");
});

test("handles @graph JSON-LD", () => {
  const result = scan(
    json({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebPage",
          name: "Platform Engineer"
        },
        jobPosting({
          "@type": ["Thing", "JobPosting"],
          title: "Platform Engineer",
          datePosted: "2026-06-10",
          validThrough: "2026-07-10",
          hiringOrganization: {
            "@type": "Organization",
            name: "Harbor Systems"
          }
        })
      ]
    }),
    {
      title: "Platform Engineer at Harbor Systems",
      heading: "Platform Engineer",
      visibleText: "Platform Engineer Harbor Systems"
    }
  );

  assert.equal(result.candidates.length, 1);
  assert.equal(result.selected.title, "Platform Engineer");
});

test("selects the best matching JobPosting when multiple candidates exist", () => {
  const result = scan(
    json([
      jobPosting({
        title: "Software Engineer",
        datePosted: "2026-06-02",
        validThrough: "2026-07-15",
        hiringOrganization: {
          "@type": "Organization",
          name: "Beta Works"
        }
      }),
      jobPosting()
    ])
  );

  assert.equal(result.candidates.length, 2);
  assert.equal(result.selected.title, "Senior Product Manager");
  assert.equal(result.selected.company, "Acme Analytics");
});

test("records malformed JSON-LD errors without selecting a posting", () => {
  const result = scan('{"@context":"https://schema.org","@type":"JobPosting","title":"Broken Role",}');

  assert.equal(result.errors.length, 1);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.selected, null);
});

test("surfaces missing datePosted as an explicit state", () => {
  const result = scan(json(jobPosting({ datePosted: undefined })));
  const model = jobDateLens.formatJobPosting(result.selected, new Date(2026, 5, 18, 12));

  assert.equal(result.candidates.length, 1);
  assert.equal(model.postedDate.state, "missing");
  assert.equal(model.status.kind, "warning");
  assert.equal(model.status.label, "Missing posted");
});

test("surfaces missing validThrough without treating the job as expired", () => {
  const result = scan(json(jobPosting({ validThrough: undefined })));
  const model = jobDateLens.formatJobPosting(result.selected, new Date(2026, 5, 18, 12));

  assert.equal(result.candidates.length, 1);
  assert.equal(model.validThrough.state, "missing");
  assert.equal(model.status.kind, "missing");
  assert.equal(model.status.label, "No expiry");
});

test("surfaces invalid date fields", () => {
  const result = scan(
    json(
      jobPosting({
        title: "Finance Analyst",
        datePosted: "not-a-date",
        validThrough: "2026-99-99"
      })
    )
  );
  const model = jobDateLens.formatJobPosting(result.selected, new Date(2026, 5, 18, 12));

  assert.equal(model.postedDate.state, "invalid");
  assert.equal(model.validThrough.state, "invalid");
  assert.equal(model.status.kind, "warning");
  assert.equal(model.status.label, "Invalid date");
});

test("marks expired postings based on validThrough", () => {
  const result = scan(
    json(
      jobPosting({
        title: "Recruiter",
        datePosted: "2026-01-10",
        validThrough: "2026-02-01"
      })
    )
  );
  const model = jobDateLens.formatJobPosting(result.selected, new Date(2026, 5, 18, 12));

  assert.equal(model.status.kind, "expired");
  assert.equal(model.status.label, "Expired");
  assert.match(model.validThrough.helper, /expired/);
});

test("treats date-only validThrough as the end of the local day", () => {
  const dateInfo = jobDateLens.parseSchemaDate("2026-06-18", "validThrough");
  const result = scan(json(jobPosting()));
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
