# JobDateLens

Chrome extension that shows public job posting dates on job pages.

https://github.com/user-attachments/assets/711439ae-b86f-41b3-9805-3e97ef4e6184

## Load locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.

## Use

JobDateLens does not scan every page automatically. It checks the current page only when you trigger it:

- macOS: press `Command+Shift+E`.
- Other platforms: press `Alt+Shift+E`.
- Or click the JobDateLens toolbar icon.

Chrome shortcuts can be changed at `chrome://extensions/shortcuts`.
If Chrome leaves the JobDateLens shortcut unassigned when the extension is installed, JobDateLens shows a small `!` badge on its toolbar icon and updates the icon title with a shortcut setup hint.
Chrome leaves JobDateLens unassigned rather than letting it overwrite another extension's existing shortcut.
This detects only JobDateLens's own unassigned Chrome extension command. Chrome extensions cannot inspect every system, browser, or user-defined shortcut, and some Chrome or operating system shortcuts may take priority.

The extension scans the active page for public job date data. Most sites are read locally from `<script type="application/ld+json">` blocks. Greenhouse-backed pages may trigger a public, unauthenticated request to Greenhouse's Job Board API for the current job id so JobDateLens can read `first_published`, `updated_at`, and `application_deadline`. Custom company Greenhouse pages are supported when the page exposes a public Greenhouse board token, such as a `boards.greenhouse.io/embed/job_board/js?for=<board>` script. Custom Ashby pages are supported when the page exposes a public `jobs.ashbyhq.com/<board>/embed` or Ashby job URL and the current URL includes an `ashby_jid` UUID; JobDateLens then reads the public Ashby-hosted job page's `JobPosting` JSON-LD.

JobDateLens does not call a JobDateLens backend, send data to a private service, or request storage permissions.

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

The suite covers parsing, provider fallbacks, browser behavior, and badge styling. Parser cases include standard JSON-LD, arrays, `@graph`, multiple candidates, missing or invalid dates, expired postings, malformed JSON, and non-job structured data.

For manual UI testing, load the extension unpacked in Chrome and visit a real job posting page that includes `JobPosting` JSON-LD.

## Package a release

`manifest.json` is the only source of truth for the extension version. Before a release, update its `version` field using [Chrome's extension version format](https://developer.chrome.com/docs/extensions/reference/manifest/version).

Create the release ZIP on macOS or Linux:

```sh
npm run package:extension
```

The command runs the full test suite, reads `manifest.json.version` directly, and then recreates `dist/jobdatelens-v<version>.zip`. It does not change `manifest.json`. The ZIP contains only the four runtime files at its root: `manifest.json`, `background.js`, `content.js`, and `content.css`.

Create a GitHub Release with the tag `v<version>` and manually attach that ZIP. Users should download and extract the ZIP, then choose the extracted folder in Chrome's **Load unpacked** dialog.
