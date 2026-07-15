# Media inputs

The default composition uses the deterministic Codex-browser captures:

```text
jobdatelens-browser-before.jpg
jobdatelens-browser-after.jpg
```

They show the privacy-safe local fixture before and after the production JobDateLens content UI runs.

To use a conventional screen recording instead, place it at `jobdatelens-demo.mp4` and set
`captureMode` to `"recording"` in `src/Composition.tsx`.
