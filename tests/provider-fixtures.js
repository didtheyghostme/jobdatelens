"use strict";

function json(value) {
  return JSON.stringify(value);
}

function jobPosting(overrides) {
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
    overrides || {}
  );
}

const parserFixtures = [
  {
    name: "generic schema.org JSON-LD with start date",
    page: {
      title: "Senior Product Manager at Acme Analytics",
      heading: "Senior Product Manager",
      visibleText: "Senior Product Manager Acme Analytics is hiring.",
      jsonLdTexts: [
        json(
          jobPosting({
            jobStartDate: "2026-08-15"
          })
        )
      ]
    },
    expected: {
      found: true,
      title: "Senior Product Manager",
      company: "Acme Analytics",
      status: "open",
      dateRows: [
        ["posted", "valid"],
        ["deadline", "valid"],
        ["start", "valid"]
      ]
    }
  },
  {
    name: "Ashby-style JSON-LD without deadline",
    page: {
      title: "Forward Deployed Engineer - Ashby",
      heading: "Forward Deployed Engineer",
      visibleText: "Forward Deployed Engineer Ashby",
      jsonLdTexts: [
        json(
          jobPosting({
            title: "Forward Deployed Engineer",
            datePosted: "2026-06-10",
            validThrough: undefined,
            hiringOrganization: {
              "@type": "Organization",
              name: "Ashby"
            }
          })
        )
      ]
    },
    expected: {
      found: true,
      title: "Forward Deployed Engineer",
      company: "Ashby",
      status: "missing",
      dateRows: [
        ["posted", "valid"],
        ["deadline", "missing"]
      ]
    }
  },
  {
    name: "stale JSON-LD from a previous route",
    page: {
      title: "Software Engineer, Singapore at Codex",
      heading: "Software Engineer, Singapore",
      visibleText: "Software Engineer, Singapore Codex Engineering",
      jsonLdTexts: [
        json(
          jobPosting({
            title: "Sales Lead, Hong Kong",
            hiringOrganization: {
              "@type": "Organization",
              name: "Codex"
            }
          })
        )
      ]
    },
    expected: {
      found: false,
      stale: 1
    }
  },
  {
    name: "missing schema.org dates",
    page: {
      title: "Technical Writer at Acme Analytics",
      heading: "Technical Writer",
      visibleText: "Technical Writer Acme Analytics",
      jsonLdTexts: [
        json(
          jobPosting({
            title: "Technical Writer",
            datePosted: undefined,
            validThrough: undefined
          })
        )
      ]
    },
    expected: {
      found: true,
      title: "Technical Writer",
      status: "missing",
      dateRows: [
        ["posted", "missing"],
        ["deadline", "missing"]
      ]
    }
  },
  {
    name: "invalid schema.org dates",
    page: {
      title: "Data Engineer at Acme Analytics",
      heading: "Data Engineer",
      visibleText: "Data Engineer Acme Analytics",
      jsonLdTexts: [
        json(
          jobPosting({
            title: "Data Engineer",
            datePosted: "soon",
            validThrough: "eventually"
          })
        )
      ]
    },
    expected: {
      found: true,
      title: "Data Engineer",
      status: "warning",
      dateRows: [
        ["posted", "invalid"],
        ["deadline", "invalid"]
      ]
    }
  }
];

const browserFixtures = [
  {
    name: "Greenhouse direct public API",
    url: "https://job-boards.greenhouse.io/pallet/jobs/5169663007",
    page: {
      title: "Job Application for Forward Deployed Product Engineer at Pallet",
      heading: "Forward Deployed Product Engineer",
      visibleText: "Forward Deployed Product Engineer Pallet San Francisco or New York"
    },
    fetch: {
      expectedUrl: "https://boards-api.greenhouse.io/v1/boards/pallet/jobs/5169663007",
      json: {
        title: "Forward Deployed Product Engineer",
        company_name: "Pallet",
        first_published: "2026-06-19T12:45:42-04:00",
        updated_at: "2026-06-19T12:45:42-04:00",
        application_deadline: null
      }
    },
    expected: {
      found: true,
      source: "greenhouse-api",
      selectedSource: "greenhouse-api",
      attempts: [
        ["dom-jsonld", "no-match"],
        ["greenhouse-api", "selected"]
      ],
      dateRows: [
        ["posted", "valid"],
        ["deadline", "missing"],
        ["updated", "valid"]
      ]
    }
  },
  {
    name: "Greenhouse custom page with embedded board token",
    url: "https://www.mongodb.com/careers/jobs/7851388",
    page: {
      title: "Senior Staff Engineer, Query Optimization at MongoDB",
      heading: "Senior Staff Engineer, Query Optimization",
      visibleText: "Senior Staff Engineer Query Optimization MongoDB",
      scripts: [
        {
          src: "https://boards.greenhouse.io/embed/job_board/js?for=mongodb"
        }
      ]
    },
    fetch: {
      expectedUrl: "https://boards-api.greenhouse.io/v1/boards/mongodb/jobs/7851388",
      json: {
        title: "Senior Staff Engineer, Query Optimization",
        company_name: "MongoDB",
        first_published: "2026-05-14T10:00:00-04:00",
        updated_at: "2026-06-12T16:30:00-04:00",
        application_deadline: "2026-08-01T23:59:59-04:00"
      }
    },
    expected: {
      found: true,
      source: "greenhouse-api",
      selectedSource: "greenhouse-api",
      attempts: [
        ["dom-jsonld", "no-match"],
        ["greenhouse-api", "selected"]
      ],
      dateRows: [
        ["posted", "valid"],
        ["deadline", "valid"],
        ["updated", "valid"]
      ]
    }
  },
  {
    name: "Greenhouse custom page without board token",
    url: "https://www.mongodb.com/careers/jobs/7851388",
    page: {
      title: "Senior Staff Engineer, Query Optimization at MongoDB",
      heading: "Senior Staff Engineer, Query Optimization",
      visibleText: "Senior Staff Engineer Query Optimization MongoDB"
    },
    fetch: {
      expectedUrl: "https://www.mongodb.com/careers/jobs/7851388",
      htmlText: "<!doctype html><title>No JSON-LD</title>",
      parsedJsonLdTexts: []
    },
    expected: {
      found: false,
      source: "html",
      reason: "html-no-match",
      selectedSource: "",
      attempts: [
        ["dom-jsonld", "no-match"],
        ["greenhouse-api", "skipped", "missing-board-token"],
        ["yc-jsonld", "skipped"],
        ["html-fallback", "no-match"]
      ],
      dateRows: []
    }
  },
  {
    name: "Lever apply page HTML fallback",
    url: "https://jobs.lever.co/shopback-2/4e119b8f-3c8d-47e6-9dde-f232930e752c/apply",
    page: {
      title: "ShopBack - Software Engineer Intern - Backend (May - Dec 2026)",
      heading: "Software Engineer Intern - Backend (May - Dec 2026)",
      visibleText:
        "Submit your application Software Engineer Intern - Backend (May - Dec 2026) ShopBack"
    },
    fetch: {
      expectedUrl: "https://jobs.lever.co/shopback-2/4e119b8f-3c8d-47e6-9dde-f232930e752c",
      htmlText: "<!doctype html><title>Lever Job</title>",
      parsedJsonLdTexts: [
        json(
          jobPosting({
            title: "Software Engineer Intern - Backend (May - Dec 2026)",
            datePosted: "2026-01-28",
            validThrough: undefined,
            hiringOrganization: {
              "@type": "Organization",
              name: "ShopBack"
            }
          })
        )
      ]
    },
    expected: {
      found: true,
      source: "html",
      selectedSource: "html-fallback",
      attempts: [
        ["dom-jsonld", "no-match"],
        ["greenhouse-api", "skipped"],
        ["yc-jsonld", "skipped"],
        ["html-fallback", "selected"]
      ],
      dateRows: [
        ["posted", "valid"],
        ["deadline", "missing"]
      ]
    }
  },
  {
    name: "YC Work at a Startup derived JSON-LD",
    url: "https://www.workatastartup.com/jobs/97127",
    page: {
      title: "Product Engineer at Ruma Care",
      heading: "Product Engineer",
      visibleText: "Product Engineer Ruma Care",
      dataPage: {
        props: {
          job: {
            id: 97127
          },
          company: {
            slug: "ruma-care"
          }
        }
      }
    },
    background: {
      expectedType: "jobdatelens:fetchYcJobPosting",
      htmlText: "<!doctype html><title>YC Job</title>",
      parsedJsonLdTexts: [
        json(
          jobPosting({
            title: "Product Engineer",
            datePosted: "2026-06-19T07:42:33Z",
            validThrough: undefined,
            hiringOrganization: {
              "@type": "Organization",
              name: "Ruma Care"
            }
          })
        )
      ]
    },
    expected: {
      found: true,
      source: "yc-jsonld",
      selectedSource: "yc-jsonld",
      attempts: [
        ["dom-jsonld", "no-match"],
        ["greenhouse-api", "skipped"],
        ["yc-jsonld", "selected"]
      ],
      dateRows: [
        ["posted", "valid"],
        ["deadline", "missing"]
      ]
    }
  }
];

module.exports = {
  browserFixtures,
  parserFixtures
};
