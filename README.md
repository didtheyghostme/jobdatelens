# JobDateLens

Chrome extension that shows public job posting dates on job pages.

https://github.com/user-attachments/assets/eaa16414-8030-4939-9729-60d1cff5b36a

## Install

1. Download `jobdatelens-v<version>.zip` from the latest GitHub release.
2. Extract the ZIP.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the extracted folder.

## Use

JobDateLens does not watch a site until you explicitly activate it. You can activate it on an individual job or on a careers listing page:

- macOS: press `Command+Shift+E`.
- Other platforms: press `Alt+Shift+E`.
- Or click the JobDateLens toolbar icon.

Chrome shortcuts can be changed at `chrome://extensions/shortcuts`.
If Chrome leaves the JobDateLens shortcut unassigned when the extension is installed, JobDateLens shows a small `!` badge on its toolbar icon and updates the icon title with a shortcut setup hint.
Chrome leaves JobDateLens unassigned rather than letting it overwrite another extension's existing shortcut.
This detects only JobDateLens's own unassigned Chrome extension command. Chrome extensions cannot inspect every system, browser, or user-defined shortcut, and some Chrome or operating system shortcuts may take priority.

After activation, JobDateLens follows job pages in that tab while they remain on the same origin (protocol, hostname, and port), across both SPA navigation and full-page loads. It ignores fragments and known click-tracking parameters while preserving URL details that may identify a job.

Toolbar or shortcut activation, **Check again**, and **Retry** always request fresh data. On automatic SPA navigation and completed same-origin page loads, non-Greenhouse pages may instead use structured job data already rendered by the browser—but only when exactly one posting matches both the visible job and the current URL. Otherwise JobDateLens immediately uses the fresh-data pipeline. Greenhouse remains API-first because its public API provides richer dates.

If a fresh lookup does not produce a trustworthy result, JobDateLens may re-check the page data once under the same verification rules. It rejects stale, mismatched, malformed, wrong-route, or ambiguous data rather than guessing. It does not poll, automatically retry, or revalidate a successful fast result in the background.

If no public job dates are available, the panel keeps watching for the next same-origin job and offers **Check again**. Other failures offer **Retry** and **Close**. Pressing the shortcut or toolbar icon again refreshes the current route; it does not turn watching off. Pressing **Close**, closing the tab, leaving the origin, restarting the browser, or reloading/updating the extension ends the session. New tabs never inherit a session.

<details>
<summary>Verification details</summary>

- The live-DOM fast path runs only for automatic SPA navigation and restored completed same-origin loads. Explicit actions stay fresh-first, and detected Greenhouse jobs stay API-first.
- Live DOM is accepted only when it exposes exactly one `JobPosting`, its JSON-LD is not guarded as unchanged from the previous route, its title matches the first visible specific `h1` or ARIA level-one heading, and it proves the current route.
- Title matching applies Unicode NFKC normalization, ignores case and formatting punctuation, and preserves meaningful `+` and `#` suffixes. Hidden or generic headings, tab titles, body text, partial matches, and fuzzy scoring do not count.
- Route proof may come from schema `url`, a URL-like `@id`, or a provider job identifier independently matched to the current route. Relative URLs are resolved against the page. Route comparison removes fragments and trailing slashes, sorts query parameters, ignores only `utm_*`, `gclid`, `fbclid`, and `msclkid`, and preserves all other parameters.
- Fetched responses must finish on the requested normalized route or the same provider job identity. Login, checkpoint, generic-page, and different-job redirects are rejected.
- After that route validation, a fresh response containing exactly one `JobPosting` is authoritative and does not require a live page-heading match. Multiple or duplicate postings remain ambiguous.
- When a fresh attempt does not produce trustworthy data, the live DOM may be re-read once; an ambiguous fresh response is not overridden. There is no polling, mutation observer, fixed-delay retry, or background revalidation after a successful fast path.

</details>

The extension scans the active page for public job date data using the trigger-aware flow above. Greenhouse-backed pages may trigger a public, unauthenticated request to Greenhouse's Job Board API for the current job id so JobDateLens can read `first_published`, `updated_at`, and `application_deadline`. Custom company Greenhouse pages are supported when the page exposes a public Greenhouse board token, such as a `boards.greenhouse.io/embed/job_board/js?for=<board>` script. Custom Ashby pages are supported when the page exposes a public `jobs.ashbyhq.com/<board>/embed` or Ashby job URL and the current URL includes an `ashby_jid` UUID; JobDateLens then reads the public Ashby-hosted job page's `JobPosting` JSON-LD.

JobDateLens does not call a JobDateLens backend or send data to a private service. It uses Chrome's memory-only `storage.session` to remember which tab and exact origin are active while the browser is running and the extension remains loaded. Each record contains only the origin, a random session token, and a navigation generation. It never stores job data, full URLs, or browsing history.

## Public date sources

| Provider/source | Current source | Public date fields shown |
| --- | --- | --- |
| Generic `schema.org JobPosting` | Page JSON-LD | `datePosted`, `validThrough`, `jobStartDate` when present |
| Greenhouse | Public Job Board API | `first_published`, `updated_at`, `application_deadline` |
| Lever | Page JSON-LD, including existing apply-page fallback | Same `schema.org JobPosting` fields |
| Ashby | Page JSON-LD, including embedded public Ashby job-page fallback | Same `schema.org JobPosting` fields |
| YC / Work at a Startup | Derived YC job page JSON-LD fallback | Same `schema.org JobPosting` fields |

Many job sites publish machine-readable dates using the [Schema.org `JobPosting`](https://schema.org/JobPosting) format. Google uses the same format for its [job posting search features](https://developers.google.com/search/docs/appearance/structured-data/job-posting). JobDateLens reads the available dates directly from the page.

Only public job-page or public job-board API fields are used. Authenticated employer APIs such as Greenhouse Harvest or private Ashby APIs are out of scope.

## Test

Run the automated tests with Node:

```sh
npm test
```

The suite covers route-attested SPA and full-page-load fast paths, fresh-first explicit actions, one-shot late DOM fallback, response redirect validation, visible `h1` and ARIA level-one verification, deterministic title matching, provider fallbacks, SPA and full-page same-origin navigation, memory-only tab sessions, exact-origin termination, stale-fingerprint rejection, rapid-navigation cancellation, neutral no-data behavior, Retry, Check again, Close, loading accessibility, reduced-motion styling, and badge layout. Parser cases include URL normalization and provider identifiers as well as standard JSON-LD, arrays, `@graph`, multiple/duplicate candidate rejection, generic headings, meaningful title symbols, missing or invalid dates, expired postings, malformed JSON, and non-job structured data.

For manual UI testing, select this repository folder in Chrome's **Load unpacked** dialog, activate JobDateLens on a careers listing or job posting, and use the site's own links to navigate between postings. Verify both SPA changes and a normal same-origin reload, then confirm that a new tab does not inherit the lens and a cross-origin navigation ends the session.

## Package a release

`manifest.json` is the only source of truth for the extension version. Before a release, update its `version` field using [Chrome's extension version format](https://developer.chrome.com/docs/extensions/reference/manifest/version).

Create the release ZIP on macOS or Linux:

```sh
npm run package:extension
```

The command runs the full test suite, reads `manifest.json.version` directly, and then recreates `dist/jobdatelens-v<version>.zip`. It does not change `manifest.json`. The ZIP contains only the four runtime files at its root: `manifest.json`, `background.js`, `content.js`, and `content.css`.

Create a GitHub Release with the tag `v<version>` and manually attach that ZIP.
