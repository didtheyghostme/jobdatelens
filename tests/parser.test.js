const assert = require("node:assert/strict");
const test = require("node:test");

const jobDateLens = require("../content.js");
const { parserFixtures } = require("./provider-fixtures");

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

function documentWithJsonLdTexts(texts, options = {}) {
  return {
    readyState: options.readyState || "complete",
    title: options.title || "",
    body: {
      innerText: options.visibleText || ""
    },
    querySelector(selector) {
      if (selector === "h1" && options.heading) {
        return { textContent: options.heading };
      }
      return null;
    },
    scripts: texts.map((text) => ({
      type: "application/ld+json",
      textContent: text
    }))
  };
}

function parserReturningDocument(expectedHtml, doc) {
  return {
    parseFromString(htmlText, type) {
      assert.equal(htmlText, expectedHtml);
      assert.equal(type, "text/html");
      return doc;
    }
  };
}

function assertExpectedDateRows(actualRows, expectedRows) {
  assert.deepEqual(
    actualRows.map((row) => [row.key, row.state]),
    expectedRows
  );
}

test("provider parser fixtures match expected date rows", () => {
  parserFixtures.forEach((fixture) => {
    const result = jobDateLens.scanJsonLdTexts(fixture.page.jsonLdTexts, {
      title: fixture.page.title,
      heading: fixture.page.heading,
      visibleText: fixture.page.visibleText
    });

    assert.equal(Boolean(result.selected), fixture.expected.found, fixture.name);
    if (!fixture.expected.found) {
      assert.equal(result.staleCandidates.length, fixture.expected.stale || 0, fixture.name);
      return;
    }

    const model = jobDateLens.formatJobPosting(
      result.selected,
      new Date("2026-06-20T12:00:00-04:00")
    );

    assert.equal(model.title, fixture.expected.title, fixture.name);
    if (fixture.expected.company) {
      assert.equal(model.company, fixture.expected.company, fixture.name);
    }
    assert.equal(model.status.kind, fixture.expected.status, fixture.name);
    assertExpectedDateRows(model.dateRows, fixture.expected.dateRows);
  });
});

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

test("exports tuned timing constants", () => {
  assert.equal(jobDateLens.HTML_FETCH_TIMEOUT_MS, 1500);
  assert.equal(jobDateLens.TRANSIENT_NOTICE_DURATION_MS, 3000);
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

test("does not select stale JobPosting JSON-LD from a previous SPA route", () => {
  const jsonLdText = json(
    jobPosting({
      title: "Sales Lead, Hong Kong",
      datePosted: "2026-06-18",
      validThrough: undefined,
      hiringOrganization: {
        "@type": "Organization",
        name: "Codex"
      }
    })
  );
  const result = scan(jsonLdText, {
    title: "Software Engineer, Singapore @ Codex",
    heading: "Software Engineer, Singapore",
    visibleText: "Software Engineer, Singapore Codex Engineering"
  });
  const notice = jobDateLens.getNoResultNotice(result, [jsonLdText], "complete");

  assert.equal(result.candidates.length, 1);
  assert.equal(result.staleCandidates.length, 1);
  assert.equal(result.selected, null);
  assert.deepEqual(notice, {
    message: "Structured job data looks stale",
    helper: "The current DOM's JobPosting JSON-LD does not match the visible job."
  });
});

test("does not let related role body text mask stale JobPosting JSON-LD", () => {
  const jsonLdText = json(
    jobPosting({
      title: "Sales Lead, Hong Kong",
      datePosted: "2026-06-18",
      validThrough: undefined,
      hiringOrganization: {
        "@type": "Organization",
        name: "Codex"
      }
    })
  );
  const result = scan(jsonLdText, {
    title: "Software Engineer, Singapore @ Codex",
    heading: "Software Engineer, Singapore",
    visibleText:
      "Software Engineer, Singapore Codex Engineering Related roles: Sales Lead, Hong Kong"
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.staleCandidates.length, 1);
  assert.equal(result.selected, null);
});

test("rejects stale one-word JobPosting title when the current heading conflicts", () => {
  const jsonLdText = json(
    jobPosting({
      title: "Recruiter",
      datePosted: "2026-06-18",
      validThrough: undefined,
      hiringOrganization: {
        "@type": "Organization",
        name: "Acme Analytics"
      }
    })
  );
  const result = scan(jsonLdText, {
    title: "Accountant at Acme Analytics",
    heading: "Accountant",
    visibleText: "Accountant Acme Analytics finance role"
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.staleCandidates.length, 1);
  assert.equal(result.selected, null);
});

test("accepts direct-loaded Ashby-style JobPosting JSON-LD without validThrough", () => {
  const result = scan(
    json(
      jobPosting({
        title: "Software Engineer, Singapore",
        datePosted: "2026-06-17",
        validThrough: undefined,
        hiringOrganization: {
          "@type": "Organization",
          name: "Codex",
          sameAs: "https://codex.xyz/"
        },
        jobLocationType: "TELECOMMUTE"
      })
    ),
    {
      title: "Software Engineer, Singapore @ Codex",
      heading: "Software Engineer, Singapore",
      visibleText: "Software Engineer, Singapore Codex Engineering"
    }
  );
  const model = jobDateLens.formatJobPosting(result.selected, new Date(2026, 5, 19, 12));

  assert.equal(result.errors.length, 0);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.staleCandidates.length, 0);
  assert.equal(result.selected.title, "Software Engineer, Singapore");
  assert.equal(result.selected.company, "Codex");
  assert.equal(result.selected.datePostedRaw, "2026-06-17");
  assert.equal(model.status.kind, "missing");
  assert.equal(model.status.label, "No expiry");
});

test("accepts current JobPosting JSON-LD when heading and page title are generic", () => {
  const result = scan(
    json(
      jobPosting({
        title: "Software Engineer, Singapore",
        datePosted: "2026-06-17",
        validThrough: undefined,
        hiringOrganization: {
          "@type": "Organization",
          name: "Codex"
        }
      })
    ),
    {
      title: "Careers | Codex",
      heading: "Job details",
      visibleText:
        "Software Engineer, Singapore Codex Engineering This is a full-stack role in Singapore."
    }
  );

  assert.equal(result.candidates.length, 1);
  assert.equal(result.staleCandidates.length, 0);
  assert.equal(result.selected.title, "Software Engineer, Singapore");
});

test("accepts current JobPosting JSON-LD when page title starts with a brand", () => {
  const result = scan(
    json(
      jobPosting({
        title: "Software Engineer",
        datePosted: "2026-06-17",
        validThrough: undefined,
        hiringOrganization: {
          "@type": "Organization",
          name: "Acme Analytics"
        }
      })
    ),
    {
      title: "Acme Analytics | Careers",
      heading: "Job details",
      visibleText: "Software Engineer Acme Analytics Engineering role"
    }
  );

  assert.equal(result.candidates.length, 1);
  assert.equal(result.staleCandidates.length, 0);
  assert.equal(result.selected.title, "Software Engineer");
});

test("accepts current JobPosting JSON-LD when heading is open positions", () => {
  const result = scan(
    json(
      jobPosting({
        title: "Software Engineer",
        datePosted: "2026-06-17",
        validThrough: undefined,
        hiringOrganization: {
          "@type": "Organization",
          name: "Codex"
        }
      })
    ),
    {
      title: "Careers | Codex",
      heading: "Open Positions",
      visibleText: "Software Engineer Codex Engineering role"
    }
  );

  assert.equal(result.candidates.length, 1);
  assert.equal(result.staleCandidates.length, 0);
  assert.equal(result.selected.title, "Software Engineer");
});

test("accepts current JobPosting JSON-LD when heading is join our team", () => {
  const result = scan(
    json(
      jobPosting({
        title: "Software Engineer",
        datePosted: "2026-06-17",
        validThrough: undefined,
        hiringOrganization: {
          "@type": "Organization",
          name: "Codex"
        }
      })
    ),
    {
      title: "Careers | Codex",
      heading: "Join Our Team",
      visibleText: "Software Engineer Codex Engineering role"
    }
  );

  assert.equal(result.candidates.length, 1);
  assert.equal(result.staleCandidates.length, 0);
  assert.equal(result.selected.title, "Software Engineer");
});

test("does not reject JobPosting JSON-LD from page title alone when heading is generic", () => {
  const jsonLdText = json(
    jobPosting({
      title: "Sales Lead, Hong Kong",
      datePosted: "2026-06-18",
      validThrough: undefined,
      hiringOrganization: {
        "@type": "Organization",
        name: "Codex"
      }
    })
  );
  const result = scan(jsonLdText, {
    title: "Software Engineer, Singapore @ Codex",
    heading: "Job details",
    visibleText: "Software Engineer, Singapore Codex Engineering"
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.staleCandidates.length, 0);
  assert.equal(result.selected.title, "Sales Lead, Hong Kong");
});

test("records malformed JSON-LD errors without selecting a posting", () => {
  const result = scan('{"@context":"https://schema.org","@type":"JobPosting","title":"Broken Role",}');

  assert.equal(result.errors.length, 1);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.selected, null);
});

test("uses a loading notice when no JobPosting is found before the page completes", () => {
  const result = scan([]);
  const notice = jobDateLens.getNoResultNotice(result, [], "interactive");

  assert.deepEqual(notice, {
    message: "Job page is still loading",
    helper: "Try again shortly if the job dates do not appear."
  });
});

test("uses a no structured data notice when a complete page has no JSON-LD", () => {
  const result = scan([]);
  const notice = jobDateLens.getNoResultNotice(result, [], "complete");

  assert.deepEqual(notice, {
    message: "No structured job data found",
    helper: "JobDateLens only reads schema.org JobPosting JSON-LD."
  });
});

test("decides when current URL HTML fallback should run", () => {
  const validJsonLdText = json(jobPosting());
  const validResult = scan(validJsonLdText);
  const missingResult = scan([]);
  const staleJsonLdText = json(
    jobPosting({
      title: "Sales Lead, Hong Kong",
      datePosted: "2026-06-18"
    })
  );
  const staleResult = scan(staleJsonLdText, {
    title: "Software Engineer, Singapore @ Codex",
    heading: "Software Engineer, Singapore",
    visibleText: "Software Engineer, Singapore Codex Engineering"
  });
  const malformedJsonLdText =
    '{"@context":"https://schema.org","@type":"JobPosting","title":"Broken Role",}';
  const malformedResult = scan(malformedJsonLdText);

  assert.equal(
    jobDateLens.shouldFetchHtmlFallback(validResult, [validJsonLdText], "complete"),
    false
  );
  assert.equal(jobDateLens.shouldFetchHtmlFallback(missingResult, [], "complete"), true);
  assert.equal(
    jobDateLens.shouldFetchHtmlFallback(staleResult, [staleJsonLdText], "complete"),
    true
  );
  assert.equal(
    jobDateLens.shouldFetchHtmlFallback(malformedResult, [malformedJsonLdText], "complete"),
    true
  );
  assert.equal(jobDateLens.shouldFetchHtmlFallback(missingResult, [], "interactive"), false);
});

test("canonicalizes allowlisted Lever apply URLs for HTML fallback", () => {
  const applyUrl =
    "https://jobs.lever.co/shopback-2/4e119b8f-3c8d-47e6-9dde-f232930e752c/apply";
  const canonicalUrl =
    "https://jobs.lever.co/shopback-2/4e119b8f-3c8d-47e6-9dde-f232930e752c";

  assert.equal(jobDateLens.getHtmlFallbackUrl(applyUrl), canonicalUrl);
  assert.equal(jobDateLens.getHtmlFallbackUrl(`${applyUrl}?utm_source=test#form`), canonicalUrl);
  assert.equal(jobDateLens.getHtmlFallbackUrl(canonicalUrl), canonicalUrl);
  assert.equal(
    jobDateLens.getHtmlFallbackUrl("https://example.com/shopback-2/posting-id/apply"),
    "https://example.com/shopback-2/posting-id/apply"
  );
  assert.equal(jobDateLens.getHtmlFallbackUrl("not a url"), "not a url");
});

test("extracts canonical Lever fallback URLs from rendered page links", () => {
  const canonicalUrl =
    "https://jobs.lever.co/binance/b3f90add-c407-45c9-b306-05b06d9a8054";
  const document = {
    querySelectorAll(selector) {
      assert.equal(selector, "a[href]");
      return [
        {
          href: "https://www.binance.com/en/careers"
        },
        {
          href: `${canonicalUrl}/apply?source=binance`
        }
      ];
    }
  };

  assert.equal(jobDateLens.getLinkedLeverFallbackUrl(document), canonicalUrl);
});

test("extracts WAAS YC lookup metadata only from matching Work at a Startup job pages", () => {
  const dataPage = JSON.stringify({
    props: {
      job: {
        id: 97127
      },
      company: {
        slug: "ruma-care"
      }
    }
  });
  const document = {
    querySelector(selector) {
      assert.equal(selector, "[data-page]");
      return {
        getAttribute(name) {
          assert.equal(name, "data-page");
          return dataPage;
        }
      };
    }
  };

  assert.deepEqual(
    jobDateLens.getWorkAtStartupYcLookupRequest(
      document,
      "https://www.workatastartup.com/jobs/97127"
    ),
    {
      jobId: 97127,
      companySlug: "ruma-care"
    }
  );
  assert.equal(
    jobDateLens.getWorkAtStartupYcLookupRequest(
      document,
      "https://www.workatastartup.com/jobs/97128"
    ),
    null
  );
  assert.equal(
    jobDateLens.getWorkAtStartupYcLookupRequest(
      document,
      "https://example.com/jobs/97127"
    ),
    null
  );
});

test("rejects unsafe or incomplete WAAS YC lookup metadata", () => {
  const documents = [
    {
      querySelector() {
        return null;
      }
    },
    {
      querySelector() {
        return {
          getAttribute() {
            return "not json";
          }
        };
      }
    },
    {
      querySelector() {
        return {
          getAttribute() {
            return JSON.stringify({
              props: {
                job: { id: 97127 },
                company: { slug: "ruma-care/../other" }
              }
            });
          }
        };
      }
    }
  ];

  documents.forEach((document) => {
    assert.equal(
      jobDateLens.getWorkAtStartupYcLookupRequest(
        document,
        "https://www.workatastartup.com/jobs/97127"
      ),
      null
    );
  });
});

test("detects Ashby lookup requests from embed hints and ashby_jid", () => {
  const jobId = "0cd9781c-e158-4b0c-9979-04ead270933a";
  const document = {
    scripts: [
      {
        src: "https://jobs.ashbyhq.com/8090%20Solutions%20Inc/embed?version=2"
      }
    ],
    querySelectorAll(selector) {
      assert.equal(selector, "iframe[src], script[src], link[href], a[href]");
      return [];
    }
  };

  assert.deepEqual(
    jobDateLens.getAshbyLookupRequest(
      document,
      `https://www.8090.ai/careers?ashby_jid=${jobId}`
    ),
    {
      boardUrl: "https://jobs.ashbyhq.com/8090%20Solutions%20Inc",
      jobId,
      jobUrl: `https://jobs.ashbyhq.com/8090%20Solutions%20Inc/${jobId}?embed=js`
    }
  );
});

test("detects Ashby lookup requests from iframe URL hints", () => {
  const jobId = "0cd9781c-e158-4b0c-9979-04ead270933a";
  const document = {
    scripts: [],
    querySelectorAll(selector) {
      assert.equal(selector, "iframe[src], script[src], link[href], a[href]");
      return [
        {
          src: `https://jobs.ashbyhq.com/8090%20Solutions%20Inc/${jobId}?embed=js`
        }
      ];
    }
  };

  assert.deepEqual(
    jobDateLens.getAshbyLookupRequest(
      document,
      `https://www.8090.ai/careers?ashby_jid=${jobId}`
    ),
    {
      boardUrl: "https://jobs.ashbyhq.com/8090%20Solutions%20Inc",
      jobId,
      jobUrl: `https://jobs.ashbyhq.com/8090%20Solutions%20Inc/${jobId}?embed=js`
    }
  );
});

test("rejects unsafe or incomplete Ashby lookup requests", () => {
  const jobId = "0cd9781c-e158-4b0c-9979-04ead270933a";
  const ashbyDocument = {
    scripts: [
      {
        src: "https://jobs.ashbyhq.com/8090%20Solutions%20Inc/embed?version=2"
      }
    ],
    querySelectorAll() {
      return [];
    }
  };
  const documents = [
    {
      document: ashbyDocument,
      url: "https://www.8090.ai/careers"
    },
    {
      document: ashbyDocument,
      url: "https://www.8090.ai/careers?ashby_jid=not-a-uuid"
    },
    {
      document: { scripts: [], querySelectorAll: () => [] },
      url: `https://www.8090.ai/careers?ashby_jid=${jobId}`
    },
    {
      document: {
        scripts: [{ src: "http://jobs.ashbyhq.com/8090%20Solutions%20Inc/embed?version=2" }],
        querySelectorAll: () => []
      },
      url: `https://www.8090.ai/careers?ashby_jid=${jobId}`
    },
    {
      document: {
        scripts: [{ src: "https://example.com/8090%20Solutions%20Inc/embed?version=2" }],
        querySelectorAll: () => []
      },
      url: `https://www.8090.ai/careers?ashby_jid=${jobId}`
    },
    {
      document: {
        scripts: [{ src: "https://jobs.ashbyhq.com/8090%20Solutions%20Inc" }],
        querySelectorAll: () => []
      },
      url: `https://www.8090.ai/careers?ashby_jid=${jobId}`
    },
    {
      document: {
        scripts: [{ src: "https://jobs.ashbyhq.com/8090%20Solutions%20Inc/embed/extra" }],
        querySelectorAll: () => []
      },
      url: `https://www.8090.ai/careers?ashby_jid=${jobId}`
    },
    {
      document: ashbyDocument,
      url: `http://www.8090.ai/careers?ashby_jid=${jobId}`
    }
  ];

  documents.forEach((entry) => {
    assert.equal(jobDateLens.getAshbyLookupRequest(entry.document, entry.url), null);
  });
});

test("rejects unsafe or unsupported linked Lever fallback URLs", () => {
  const documents = [
    {
      querySelectorAll() {
        return [{ href: "https://jobs.lever.co.evil.com/binance/posting-id/apply" }];
      }
    },
    {
      querySelectorAll() {
        return [{ href: "http://jobs.lever.co/binance/posting-id/apply" }];
      }
    },
    {
      querySelectorAll() {
        return [{ href: "https://jobs.lever.co/binance/posting-id/extra" }];
      }
    },
    {
      querySelectorAll() {
        return [{ href: "https://example.com/binance/posting-id/apply" }];
      }
    }
  ];

  documents.forEach((document) => {
    assert.equal(jobDateLens.getLinkedLeverFallbackUrl(document), null);
  });
});

test("detects direct Greenhouse API lookup requests", () => {
  assert.deepEqual(
    jobDateLens.getGreenhouseLookupRequest(
      null,
      "https://job-boards.greenhouse.io/anthropic/jobs/5238606008"
    ),
    {
      boardToken: "anthropic",
      jobId: "5238606008",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/anthropic/jobs/5238606008"
    }
  );
  assert.deepEqual(
    jobDateLens.getGreenhouseLookupRequest(
      null,
      "https://boards.greenhouse.io/pallet/jobs/5169663007"
    ),
    {
      boardToken: "pallet",
      jobId: "5169663007",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/pallet/jobs/5169663007"
    }
  );
});

test("detects custom Greenhouse API lookup requests from embed hints", () => {
  const rippleDocument = {
    scripts: [],
    querySelectorAll(selector) {
      assert.equal(selector, "script[src], link[href], a[href]");
      return [
        {
          href: "https://boards.greenhouse.io/embed/job_board/js?for=ripple"
        }
      ];
    }
  };
  const mongodbDocument = {
    scripts: [
      {
        src: "https://boards.greenhouse.io/embed/job_board/js?for=mongodb"
      }
    ],
    querySelectorAll(selector) {
      assert.equal(selector, "script[src], link[href], a[href]");
      return [];
    }
  };

  assert.deepEqual(
    jobDateLens.getGreenhouseLookupRequest(
      rippleDocument,
      "https://ripple.com/careers/all-jobs/job/7724653/?gh_jid=7724653"
    ),
    {
      boardToken: "ripple",
      jobId: "7724653",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/ripple/jobs/7724653"
    }
  );
  assert.deepEqual(
    jobDateLens.getGreenhouseLookupRequest(
      mongodbDocument,
      "https://www.mongodb.com/careers/jobs/7851388"
    ),
    {
      boardToken: "mongodb",
      jobId: "7851388",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/mongodb/jobs/7851388"
    }
  );
});

test("does not guess Greenhouse board tokens for custom pages without embed hints", () => {
  assert.equal(
    jobDateLens.getGreenhouseLookupRequest(
      { scripts: [], querySelectorAll: () => [] },
      "https://www.mongodb.com/careers/jobs/7851388"
    ),
    null
  );
});

test("rejects unsafe Greenhouse lookup URLs", () => {
  assert.equal(
    jobDateLens.getGreenhouseLookupRequest(
      null,
      "http://job-boards.greenhouse.io/anthropic/jobs/5238606008"
    ),
    null
  );
  assert.equal(
    jobDateLens.getGreenhouseLookupRequest(
      null,
      "https://job-boards.greenhouse.io/anthropic/jobs/not-a-number"
    ),
    null
  );
  assert.equal(
    jobDateLens.getGreenhouseLookupRequest(
      { querySelectorAll: () => [] },
      "https://example.com/careers/jobs/5238606008"
    ),
    null
  );
});

test("formats Greenhouse public dates as visible date rows", () => {
  const candidate = jobDateLens.createGreenhouseCandidate(
    {
      title: "Software Engineer, RL Data",
      company_name: "Anthropic",
      first_published: "2026-06-02T10:06:04-04:00",
      updated_at: "2026-06-09T07:25:14-04:00",
      application_deadline: null
    },
    {
      boardToken: "anthropic",
      jobId: "5238606008"
    }
  );
  const model = jobDateLens.formatJobPosting(candidate, new Date("2026-06-20T12:00:00-04:00"));

  assert.equal(model.title, "Software Engineer, RL Data");
  assert.equal(model.company, "Anthropic");
  assert.deepEqual(
    model.dateRows.map((row) => [row.label, row.state]),
    [
      ["Posted", "valid"],
      ["Deadline", "missing"],
      ["Last updated", "valid"]
    ]
  );
  assert.equal(model.validThrough.label, "Not provided");
  assert.match(model.dateRows[1].helper, /Greenhouse API: application_deadline/);
  assert.equal(model.status.kind, "missing");
});

test("uses Greenhouse application_deadline as the deadline when present", () => {
  const candidate = jobDateLens.createGreenhouseCandidate(
    {
      title: "Program Manager",
      company_name: "Example",
      first_published: "2026-06-01T09:00:00-04:00",
      updated_at: "2026-06-05T09:00:00-04:00",
      application_deadline: "2026-07-31T23:59:59-04:00"
    },
    {
      boardToken: "example",
      jobId: "123"
    }
  );
  const model = jobDateLens.formatJobPosting(candidate, new Date("2026-06-20T12:00:00-04:00"));
  const deadline = model.dateRows.find((row) => row.key === "deadline");

  assert.equal(deadline.state, "valid");
  assert.match(deadline.helper, /expires in/);
  assert.equal(model.status.kind, "open");
});

test("surfaces same-meaning date source conflicts", () => {
  const sources = jobDateLens.normalizeDateSources([
    jobDateLens.createDateSource({
      key: "posted",
      label: "Posted",
      raw: "2026-06-01T09:00:00-04:00",
      source: "Greenhouse API",
      field: "first_published",
      usage: "datePosted",
      priority: 100
    }),
    jobDateLens.createDateSource({
      key: "posted",
      label: "Posted",
      raw: "2026-06-02T09:00:00-04:00",
      source: "Greenhouse page",
      field: "published_at",
      usage: "datePosted",
      priority: 90
    })
  ]);

  assert.equal(sources.length, 1);
  assert.equal(sources[0].raw, "2026-06-01T09:00:00-04:00");
  assert.deepEqual(sources[0].conflicts, [
    "Greenhouse page: published_at=2026-06-02T09:00:00-04:00"
  ]);
});

test("scans fetched HTML text for matching JobPosting JSON-LD", () => {
  const html = '<!doctype html><script type="application/ld+json"></script>';
  const jsonLdText = json(
    jobPosting({
      title: "Software Engineer, Singapore",
      datePosted: "2026-06-17",
      validThrough: undefined,
      hiringOrganization: {
        "@type": "Organization",
        name: "Codex"
      }
    })
  );
  const context = {
    title: "Software Engineer, Singapore @ Codex",
    heading: "Software Engineer, Singapore",
    visibleText: "Software Engineer, Singapore Codex Engineering"
  };
  const parser = parserReturningDocument(html, documentWithJsonLdTexts([jsonLdText]));
  const snapshot = jobDateLens.scanHtmlText(html, context, parser);

  assert.equal(snapshot.readyState, "complete");
  assert.equal(snapshot.jsonLdTexts.length, 1);
  assert.equal(snapshot.result.selected.title, "Software Engineer, Singapore");
  assert.equal(snapshot.result.selected.company, "Codex");
});

test("malformed DOM JSON-LD does not mask a valid fetched HTML result", () => {
  const malformedJsonLdText =
    '{"@context":"https://schema.org","@type":"JobPosting","title":"Broken Role",}';
  const malformedResult = scan(malformedJsonLdText);
  const html = '<!doctype html><script type="application/ld+json"></script>';
  const fetchedJsonLdText = json(jobPosting());
  const parser = parserReturningDocument(html, documentWithJsonLdTexts([fetchedJsonLdText]));
  const snapshot = jobDateLens.scanHtmlText(html, defaultContext, parser);

  assert.equal(
    jobDateLens.shouldFetchHtmlFallback(malformedResult, [malformedJsonLdText], "complete"),
    true
  );
  assert.equal(malformedResult.selected, null);
  assert.equal(snapshot.result.selected.title, "Senior Product Manager");
});

test("uses a no JobPosting notice when JSON-LD has no job posting", () => {
  const jsonLdText = json({
    "@context": "https://schema.org",
    "@type": "WebSite",
    url: "https://example.com"
  });
  const result = scan(jsonLdText);
  const notice = jobDateLens.getNoResultNotice(result, [jsonLdText], "complete");

  assert.deepEqual(notice, {
    message: "No JobPosting JSON-LD found",
    helper: "This page has structured data, but not schema.org JobPosting data."
  });
});

test("uses an unreadable structured data notice when all JSON-LD is malformed", () => {
  const jsonLdText = '{"@context":"https://schema.org","@type":"JobPosting","title":"Broken Role",}';
  const result = scan(jsonLdText);
  const notice = jobDateLens.getNoResultNotice(result, [jsonLdText], "complete");

  assert.deepEqual(notice, {
    message: "Structured job data could not be read",
    helper: "The page includes JSON-LD, but it is not valid JSON."
  });
});

test("does not return a no-result notice when a JobPosting is selected", () => {
  const jsonLdText = json(jobPosting());
  const result = scan(jsonLdText);

  assert.equal(jobDateLens.getNoResultNotice(result, [jsonLdText], "loading"), null);
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
    ),
    {
      title: "Finance Analyst at Acme Analytics",
      heading: "Finance Analyst",
      visibleText: "Finance Analyst Acme Analytics is hiring."
    }
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
    ),
    {
      title: "Recruiter at Acme Analytics",
      heading: "Recruiter",
      visibleText: "Recruiter Acme Analytics is hiring."
    }
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
