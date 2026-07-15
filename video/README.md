# JobDateLens X promo

Reusable Remotion composition for a 12-second, square product demo suitable for X.
It also includes a native 16:9 version for the GitHub README.

## Current state

The composition defaults to deterministic before/after frames captured from the Codex browser. The local fixture loads the production `content.js` and `content.css`, so the visible JobDateLens result uses the extension's real parser and badge UI without exposing personal browser data.

For a simpler illustrated product demo, render with `captureMode` set to `"placeholder"` and `showPlaceholderWatermark` set to `false`. Keep the watermark enabled for draft placeholder reviews.

The dedicated `JobDateLensSimpleMockup` composition provides that clean illustrated version without runtime prop overrides.
It includes animated `Command+Shift+E` keycaps and synchronized highlights between the Date posted and Application deadline callouts and their matching panel rows.

## Add the real recording

Use the deterministic local fixture so the recording contains no company or personal data and its relative dates remain useful on any recording day:

1. Run `npm run demo:serve` and leave it running.
2. Load JobDateLens unpacked from the repository root in Chrome.
3. Open <http://127.0.0.1:4173> in a clean Chrome profile or window.
4. Hide bookmarks and unrelated extensions, then size the window to a 16:9 capture area at 1080p or higher.
5. Start recording and hold the untouched page for about two seconds.
6. Click the JobDateLens toolbar icon or press `Command+Shift+E`.
7. Leave the real JobDateLens badge visible for at least four seconds, then stop recording.
8. Save the recording as `public/jobdatelens-demo.mp4`.
9. In `src/Composition.tsx`, change `captureMode` to `"recording"`.
10. Adjust `ctaText` if the final call to action is not `Link in post`.

The server generates `datePosted` as seven days ago and `validThrough` as 31 days from the recording day. Validate the fixture at any time with `npm run demo:validate`.

Avoid personal bookmarks, signed-in account details, notifications, or unrelated browser extensions in the recording.

## Commands

```sh
npm install
npm run demo:validate
npm run demo:serve
npm run dev
npm run lint
npm run still:hook
npm run still:trigger
npm run still:reveal
npm run still:fields
npm run still:end
npm run still:readme
npm run render:promo
npm run render:readme
```

The browser-capture video is written to `out/jobdatelens-x.mp4`.

Render the clean illustrated promo currently linked from the repository README with:

```sh
npx remotion render JobDateLensSimpleMockup ../jobdatelens-simple-mockup.mp4 --codec=h264
```

Render the landscape GitHub README version with:

```sh
npm run render:readme
```

The upload-ready file is written to `../jobdatelens-readme-demo.mp4`. Upload it
through GitHub's Markdown editor, then replace the repository README's current
attachment URL with the new `github.com/user-attachments/assets/...` URL.

## Composition contract

- Composition ID: `JobDateLensXPromo`
- Canvas: 1080 x 1080
- Frame rate: 30 fps
- Duration: 12 seconds / 360 frames
- Audio: intentionally optional; the story must work muted
- Safe margin: 72 px

The `JobDateLensReadmeDemo` composition uses the same 360-frame timeline on a
1280 x 720 canvas, with the message on the left and product mockup on the right.

Timeline:

| Time | Message |
| --- | --- |
| 0-3s | Before you apply: Find out when this job was posted. |
| 3-6s | Trigger with one click or sequentially animated `Command`, `Shift`, and `E` keycaps. |
| 6-10s | Reveal Date posted and Application deadline in sequence while highlighting their matching POSTED and DEADLINE panel rows. |
| 10-12s | JobDateLens end card and CTA. |

## Publishing gate

Before publishing, verify all of the following:

- The placeholder watermark is absent.
- The product stage shows either the verified Codex-browser capture or a clean Chrome recording.
- Dates and status are readable on a phone-sized preview.
- Shortcut keypresses and date-row highlights remain synchronized with their callouts.
- No personal or employer-sensitive information is visible.
- The exported MP4 is no longer than 12 seconds and remains below X's upload limit.
- The post contains the correct installation or beta link.

## License note

Remotion currently uses a custom license. It is free for individuals and organizations of up to three people, including commercial use; larger organizations need a company license. Review the current terms before the team size or use case changes: <https://www.remotion.dev/docs/license/pricing>.
