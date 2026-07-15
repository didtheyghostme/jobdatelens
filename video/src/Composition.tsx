import {Composition} from "remotion";
import {
  JOB_DATE_LENS_PROMO_DURATION_IN_FRAMES,
  JobDateLensPromo,
  type JobDateLensPromoProps,
} from "./JobDateLensPromo";

export const DEFAULT_PROMO_PROPS: JobDateLensPromoProps = {
  recordingFile: "jobdatelens-demo.mp4",
  captureMode: "browser-stills",
  showPlaceholderWatermark: true,
  ctaText: "Link in post",
  layout: "square",
};

export const SIMPLE_MOCKUP_PROPS: JobDateLensPromoProps = {
  ...DEFAULT_PROMO_PROPS,
  captureMode: "placeholder",
  showPlaceholderWatermark: false,
};

export const README_DEMO_PROPS: JobDateLensPromoProps = {
  ...SIMPLE_MOCKUP_PROPS,
  layout: "landscape",
};

export const MyComposition = () => {
  return (
    <>
      <Composition
        id="JobDateLensXPromo"
        component={JobDateLensPromo}
        durationInFrames={JOB_DATE_LENS_PROMO_DURATION_IN_FRAMES}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={DEFAULT_PROMO_PROPS}
      />
      <Composition
        id="JobDateLensSimpleMockup"
        component={JobDateLensPromo}
        durationInFrames={JOB_DATE_LENS_PROMO_DURATION_IN_FRAMES}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={SIMPLE_MOCKUP_PROPS}
      />
      <Composition
        id="JobDateLensReadmeDemo"
        component={JobDateLensPromo}
        durationInFrames={JOB_DATE_LENS_PROMO_DURATION_IN_FRAMES}
        fps={30}
        width={1280}
        height={720}
        defaultProps={README_DEMO_PROPS}
      />
    </>
  );
};
