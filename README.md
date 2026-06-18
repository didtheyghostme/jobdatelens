# JobDateLens

Chrome extension that shows `datePosted` and `validThrough` from `JobPosting` JSON-LD on job pages.

## Load locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.

The extension scans `http` and `https` pages locally for `<script type="application/ld+json">` blocks. It does not call a backend, send page data anywhere, or request storage permissions.

## Test

Run the parser tests with Node:

```sh
npm test
```

The tests use inline JSON-LD samples and cover standard JSON-LD, arrays, `@graph`, multiple candidates, missing or invalid dates, expired postings, malformed JSON, and non-job structured data.

For manual UI testing, load the extension unpacked in Chrome and visit a real job posting page that includes `JobPosting` JSON-LD.
