import {Video} from "@remotion/media";
import type {CSSProperties, FC, ReactNode} from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  interpolateColors,
  staticFile,
  useCurrentFrame,
} from "remotion";

export const JOB_DATE_LENS_PROMO_DURATION_IN_FRAMES = 12 * 30;

export type JobDateLensPromoProps = {
  recordingFile: string;
  captureMode: "browser-stills" | "recording" | "placeholder";
  showPlaceholderWatermark: boolean;
  ctaText: string;
};

const colors = {
  ink: "#18222f",
  muted: "#667485",
  border: "#c9d3df",
  paper: "#ffffff",
  canvas: "#eef3f8",
  navy: "#101a2c",
  green: "#16a36a",
  greenSoft: "#d8f3dc",
  amber: "#b56a00",
  amberSoft: "#fff1c2",
};

const fontFamily =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const cardShadow = "0 30px 90px rgba(16, 26, 44, 0.24)";

const dateFields = [
  {panelLabel: "POSTED", pillLabel: "Date posted"},
  {panelLabel: "DEADLINE", pillLabel: "Application deadline"},
] as const;

const FIELD_HIGHLIGHTS_START_FRAME = 198;
const FIELD_HIGHLIGHT_STAGGER_IN_FRAMES = 18;
const FIELD_HIGHLIGHT_ENTER_IN_FRAMES = 12;

const shortcutKeys = [
  {label: "⌘", pressStartFrame: 28, width: 72},
  {label: "⇧", pressStartFrame: 33, width: 72},
  {label: "E", pressStartFrame: 38, width: 64},
] as const;

const SHORTCUT_PRESS_IN_FRAMES = 5;
const SHORTCUT_RELEASE_START_FRAME = 50;
const SHORTCUT_RELEASE_END_FRAME = 56;

const Pill: FC<{
  children: ReactNode;
  style?: CSSProperties;
}> = ({children, style}) => {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        padding: "10px 18px",
        fontSize: 22,
        fontWeight: 750,
        lineHeight: 1,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

const PlaceholderPanel: FC = () => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: "absolute",
        right: 20,
        top: 20,
        width: 315,
        overflow: "hidden",
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        background: colors.paper,
        boxShadow: "0 18px 40px rgba(20, 31, 43, 0.22)",
        color: colors.ink,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          borderBottom: "1px solid #e1e7ee",
          background: "#f7f9fb",
        }}
      >
        <strong style={{fontSize: 17}}>JobDateLens</strong>
        <Pill
          style={{
            padding: "6px 12px",
            background: colors.greenSoft,
            color: "#0f5132",
            fontSize: 14,
          }}
        >
          Open
        </Pill>
      </div>
      <div style={{display: "grid", gap: 14, padding: 16}}>
        {[
          ["ROLE", "Software Engineer", ""],
          ["COMPANY", "Example Labs", ""],
          ["POSTED", "Jul 8, 2026", "posted 7 days ago"],
          ["DEADLINE", "Aug 15, 2026", "expires in 31 days"],
        ].map(([label, value, helper]) => {
          const highlightedFieldIndex = dateFields.findIndex(
            (field) => field.panelLabel === label,
          );
          const highlightStartFrame =
            FIELD_HIGHLIGHTS_START_FRAME +
            highlightedFieldIndex * FIELD_HIGHLIGHT_STAGGER_IN_FRAMES;

          return (
            <div
              key={label}
              style={{
                display: "grid",
                gridTemplateColumns: "88px 1fr",
                gap: 8,
                alignItems: "start",
                margin: "-5px -7px",
                padding: "5px 7px",
                borderRadius: 8,
                background:
                  highlightedFieldIndex === -1
                    ? "transparent"
                    : `rgba(114, 224, 174, ${interpolate(
                        frame,
                        [highlightStartFrame, highlightStartFrame + 10],
                        [0, 0.2],
                        {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                          easing: Easing.bezier(0.16, 1, 0.3, 1),
                        },
                      )})`,
                boxShadow:
                  highlightedFieldIndex === -1
                    ? "none"
                    : `0 0 0 ${interpolate(
                        frame,
                        [highlightStartFrame, highlightStartFrame + 10],
                        [0, 2],
                        {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                          easing: Easing.bezier(0.16, 1, 0.3, 1),
                        },
                      )}px rgba(22, 163, 106, 0.92)`,
                scale:
                  highlightedFieldIndex === -1
                    ? 1
                    : interpolate(
                        frame,
                        [highlightStartFrame, highlightStartFrame + 6, highlightStartFrame + 14],
                        [1, 1.02, 1],
                        {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                          easing: Easing.bezier(0.16, 1, 0.3, 1),
                        },
                      ),
              }}
            >
              <span
                style={{
                  color: colors.muted,
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: "0.04em",
                }}
              >
                {label}
              </span>
              <span style={{fontSize: 15, fontWeight: 700}}>
                {value}
                {helper ? (
                  <small
                    style={{
                      display: "block",
                      marginTop: 3,
                      color: colors.muted,
                      fontSize: 12,
                      fontWeight: 550,
                    }}
                  >
                    {helper}
                  </small>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const PlaceholderJobPage: FC<{showPanel: boolean}> = ({showPanel}) => {
  return (
    <AbsoluteFill style={{background: "#ffffff"}}>
      <div
        style={{
          height: 54,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 18px",
          borderBottom: "1px solid #dfe5ec",
          background: "#f7f9fb",
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
          <div
            key={color}
            style={{width: 12, height: 12, borderRadius: "50%", background: color}}
          />
        ))}
        <div
          style={{
            flex: 1,
            marginLeft: 12,
            padding: "8px 16px",
            border: "1px solid #d9e0e8",
            borderRadius: 8,
            background: "#ffffff",
            color: colors.muted,
            fontSize: 13,
          }}
        >
          jobs.example.com/software-engineer
        </div>
      </div>
      <div style={{padding: "52px 64px", color: colors.ink}}>
        <div
          style={{
            width: 84,
            height: 24,
            marginBottom: 24,
            borderRadius: 6,
            background: "#dce5ef",
          }}
        />
        <h2 style={{margin: 0, maxWidth: 520, fontSize: 42, lineHeight: 1.08}}>
          Software Engineer
        </h2>
        <p style={{margin: "14px 0 34px", color: colors.muted, fontSize: 20}}>
          Example Labs · Singapore · Hybrid
        </p>
        {[590, 515, 555, 430].map((width) => (
          <div
            key={width}
            style={{
              width,
              height: 13,
              marginBottom: 15,
              borderRadius: 5,
              background: "#e8edf3",
            }}
          />
        ))}
        <div
          style={{
            width: 160,
            marginTop: 34,
            padding: "14px 20px",
            borderRadius: 9,
            background: colors.navy,
            color: colors.paper,
            textAlign: "center",
            fontSize: 16,
            fontWeight: 750,
          }}
        >
          Apply now
        </div>
      </div>
      {showPanel ? <PlaceholderPanel /> : null}
    </AbsoluteFill>
  );
};

const BrowserCapture: FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{background: colors.paper}}>
      <Img
        src={staticFile("jobdatelens-browser-before.jpg")}
        style={{width: "100%", height: "100%", objectFit: "cover"}}
      />
      <Img
        src={staticFile("jobdatelens-browser-after.jpg")}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: interpolate(frame, [174, 182], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      />
    </AbsoluteFill>
  );
};

const ProductStage: FC<
  Pick<
    JobDateLensPromoProps,
    "captureMode" | "recordingFile" | "showPlaceholderWatermark"
  >
> = ({captureMode, recordingFile, showPlaceholderWatermark}) => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: "absolute",
        left: 72,
        top: 328,
        width: 936,
        height: 576,
        overflow: "hidden",
        border: "1px solid rgba(201, 211, 223, 0.9)",
        borderRadius: 22,
        background: colors.paper,
        boxShadow: cardShadow,
        scale: interpolate(frame, [150, 205, 300, 330], [1, 1.12, 1.12, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        translate: interpolate(
          frame,
          [150, 205, 300, 330],
          ["0px 0px", "-42px 24px", "-42px 24px", "0px 0px"],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          },
        ),
      }}
    >
      {captureMode === "placeholder" ? (
        <PlaceholderJobPage showPanel={frame >= 180} />
      ) : captureMode === "browser-stills" ? (
        <BrowserCapture />
      ) : (
        <Video
          src={staticFile(recordingFile)}
          muted
          objectFit="cover"
          style={{width: "100%", height: "100%"}}
        />
      )}
      {captureMode === "placeholder" && showPlaceholderWatermark ? (
        <div
          style={{
            position: "absolute",
            left: 16,
            bottom: 14,
            padding: "7px 11px",
            borderRadius: 7,
            background: "rgba(16, 26, 44, 0.88)",
            color: "#ffffff",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.06em",
          }}
        >
          PLACEHOLDER FOOTAGE · DO NOT PUBLISH
        </div>
      ) : null}
    </div>
  );
};

const Hook: FC = () => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: "absolute",
        left: 72,
        right: 72,
        top: 72,
        opacity: interpolate(frame, [0, 14, 76, 90], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        translate: interpolate(frame, [0, 18], ["0px 22px", "0px 0px"], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      }}
    >
      <Pill style={{marginBottom: 22, background: colors.amberSoft, color: colors.amber}}>
        Before you apply
      </Pill>
      <h1
        style={{
          maxWidth: 936,
          margin: 0,
          color: colors.navy,
          fontSize: 62,
          fontWeight: 850,
          letterSpacing: "-0.045em",
          lineHeight: 1.02,
        }}
      >
        Find out when this job was posted.
      </h1>
    </div>
  );
};

const TriggerCaption: FC = () => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: "absolute",
        left: 72,
        right: 72,
        top: 92,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        opacity: interpolate(frame, [0, 12, 72, 90], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <div>
        <div style={{color: colors.navy, fontSize: 54, fontWeight: 850, letterSpacing: "-0.04em"}}>
          One click.
        </div>
        <div style={{marginTop: 8, color: colors.muted, fontSize: 27, fontWeight: 650}}>
          Or press the shortcut.
        </div>
      </div>
      <div style={{display: "flex", alignItems: "flex-start", gap: 10}}>
        {shortcutKeys.map((key) => (
          <div
            key={key.label}
            style={{
              boxSizing: "border-box",
              width: key.width,
              height: 68,
              display: "grid",
              placeItems: "center",
              border: "1px solid",
              borderColor: interpolateColors(
                frame,
                [
                  0,
                  key.pressStartFrame,
                  key.pressStartFrame + SHORTCUT_PRESS_IN_FRAMES,
                  SHORTCUT_RELEASE_START_FRAME,
                  SHORTCUT_RELEASE_END_FRAME,
                  90,
                ],
                [
                  colors.border,
                  colors.border,
                  colors.green,
                  colors.green,
                  colors.border,
                  colors.border,
                ],
              ),
              borderBottomWidth: interpolate(
                frame,
                [
                  key.pressStartFrame,
                  key.pressStartFrame + SHORTCUT_PRESS_IN_FRAMES,
                  SHORTCUT_RELEASE_START_FRAME,
                  SHORTCUT_RELEASE_END_FRAME,
                ],
                [5, 1, 1, 5],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                },
              ),
              borderRadius: 14,
              background: interpolateColors(
                frame,
                [
                  0,
                  key.pressStartFrame,
                  key.pressStartFrame + SHORTCUT_PRESS_IN_FRAMES,
                  SHORTCUT_RELEASE_START_FRAME,
                  SHORTCUT_RELEASE_END_FRAME,
                  90,
                ],
                [
                  colors.paper,
                  colors.paper,
                  colors.greenSoft,
                  colors.greenSoft,
                  colors.paper,
                  colors.paper,
                ],
              ),
              color: interpolateColors(
                frame,
                [
                  0,
                  key.pressStartFrame,
                  key.pressStartFrame + SHORTCUT_PRESS_IN_FRAMES,
                  SHORTCUT_RELEASE_START_FRAME,
                  SHORTCUT_RELEASE_END_FRAME,
                  90,
                ],
                [
                  colors.navy,
                  colors.navy,
                  "#0f5132",
                  "#0f5132",
                  colors.navy,
                  colors.navy,
                ],
              ),
              fontSize: 29,
              fontWeight: 850,
              lineHeight: 1,
              translate: interpolate(
                frame,
                [
                  key.pressStartFrame,
                  key.pressStartFrame + SHORTCUT_PRESS_IN_FRAMES,
                  SHORTCUT_RELEASE_START_FRAME,
                  SHORTCUT_RELEASE_END_FRAME,
                ],
                ["0px 0px", "0px 4px", "0px 4px", "0px 0px"],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                },
              ),
              boxShadow: `0 ${interpolate(
                frame,
                [
                  key.pressStartFrame,
                  key.pressStartFrame + SHORTCUT_PRESS_IN_FRAMES,
                  SHORTCUT_RELEASE_START_FRAME,
                  SHORTCUT_RELEASE_END_FRAME,
                ],
                [10, 4, 4, 10],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                },
              )}px ${interpolate(
                frame,
                [
                  key.pressStartFrame,
                  key.pressStartFrame + SHORTCUT_PRESS_IN_FRAMES,
                  SHORTCUT_RELEASE_START_FRAME,
                  SHORTCUT_RELEASE_END_FRAME,
                ],
                [26, 12, 12, 26],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                },
              )}px rgba(16, 26, 44, 0.12)`,
            }}
          >
            {key.label}
          </div>
        ))}
      </div>
    </div>
  );
};

const RevealCaption: FC = () => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: "absolute",
        left: 72,
        right: 72,
        top: 76,
        opacity: interpolate(frame, [0, 12, 104, 120], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <Pill style={{marginBottom: 18, background: colors.greenSoft, color: "#0f5132"}}>
        Public job-page data
      </Pill>
      <div style={{color: colors.navy, fontSize: 58, fontWeight: 850, letterSpacing: "-0.04em"}}>
        Dates, surfaced instantly.
      </div>
    </div>
  );
};

const FieldHighlights: FC = () => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: "absolute",
        left: 72,
        right: 72,
        top: 230,
        display: "flex",
        gap: 14,
      }}
    >
      {dateFields.map((field, index) => (
        <Pill
          key={field.pillLabel}
          style={{
            opacity: interpolate(
              frame,
              [
                index * FIELD_HIGHLIGHT_STAGGER_IN_FRAMES,
                index * FIELD_HIGHLIGHT_STAGGER_IN_FRAMES + FIELD_HIGHLIGHT_ENTER_IN_FRAMES,
              ],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              },
            ),
            translate: interpolate(
              frame,
              [
                index * FIELD_HIGHLIGHT_STAGGER_IN_FRAMES,
                index * FIELD_HIGHLIGHT_STAGGER_IN_FRAMES + FIELD_HIGHLIGHT_ENTER_IN_FRAMES,
              ],
              ["0px 14px", "0px 0px"],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              },
            ),
            border: `1px solid ${colors.border}`,
            background: colors.paper,
            color: colors.navy,
            boxShadow: "0 8px 20px rgba(16, 26, 44, 0.09)",
          }}
        >
          <span style={{marginRight: 9, color: colors.green}}>✓</span>
          {field.pillLabel}
        </Pill>
      ))}
    </div>
  );
};

const EndCard: FC<{ctaText: string}> = ({ctaText}) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        background: colors.navy,
        color: colors.paper,
        opacity: interpolate(frame, [0, 10], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 720,
          height: 720,
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: "50%",
          scale: interpolate(frame, [0, 60], [0.72, 1.08], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      />
      <div style={{zIndex: 1, width: 880, textAlign: "center"}}>
        <div
          style={{
            width: 96,
            height: 96,
            margin: "0 auto 34px",
            display: "grid",
            placeItems: "center",
            border: "8px solid #72e0ae",
            borderRadius: "50%",
            color: "#72e0ae",
            fontSize: 42,
            fontWeight: 900,
          }}
        >
          J
        </div>
        <h2
          style={{
            margin: 0,
            fontSize: 92,
            fontWeight: 900,
            letterSpacing: "-0.055em",
            lineHeight: 1,
          }}
        >
          JobDateLens
        </h2>
        <p style={{margin: "28px 0 44px", color: "#c9d6e6", fontSize: 36, fontWeight: 600}}>
          Apply with more context.
        </p>
        <Pill style={{background: "#72e0ae", color: colors.navy, fontSize: 26}}>{ctaText}</Pill>
      </div>
    </AbsoluteFill>
  );
};

export const JobDateLensPromo: FC<JobDateLensPromoProps> = ({
  captureMode,
  recordingFile,
  showPlaceholderWatermark,
  ctaText,
}) => {
  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        background:
          "radial-gradient(circle at 84% 8%, rgba(114, 224, 174, 0.25), transparent 34%), #eef3f8",
        color: colors.ink,
        fontFamily,
      }}
    >
      <Sequence name="Product recording" durationInFrames={360} premountFor={30}>
        <ProductStage
          captureMode={captureMode}
          recordingFile={recordingFile}
          showPlaceholderWatermark={showPlaceholderWatermark}
        />
      </Sequence>
      <Sequence name="Hook" durationInFrames={90} premountFor={30}>
        <Hook />
      </Sequence>
      <Sequence name="Trigger" from={90} durationInFrames={90} premountFor={30}>
        <TriggerCaption />
      </Sequence>
      <Sequence name="Reveal" from={180} durationInFrames={120} premountFor={30}>
        <RevealCaption />
      </Sequence>
      <Sequence
        name="Fields"
        from={FIELD_HIGHLIGHTS_START_FRAME}
        durationInFrames={112}
        premountFor={30}
      >
        <FieldHighlights />
      </Sequence>
      <Sequence name="End card" from={300} durationInFrames={60} premountFor={30}>
        <EndCard ctaText={ctaText} />
      </Sequence>
    </AbsoluteFill>
  );
};
