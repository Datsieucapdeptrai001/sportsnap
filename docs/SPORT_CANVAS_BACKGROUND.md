# Sport canvas background

The background is drawn entirely with the native Canvas 2D API. It uses no
photographs, video, external media, animation libraries, or classifier data.
The previous photo reel and its delivery assets have been removed.

- Two eight-second vector action loops: a football kick with a ballistic curved
  shot and damped net ripple; a basketball jump/dunk with gravity and floor bounces.
- A pool of 64 reusable particles provides ball trails and impact bursts.
  Glow gradients are cached in a small offscreen canvas instead of applying
  expensive per-particle shadow blurs.
- Passive window pointer listeners provide cursor repulsion and touch/click
  ripples. The decorative layer has `pointer-events: none` and never intercepts
  taps, scrolling, file selection, or navigation.
- `requestAnimationFrame` targets a maximum of 60 draws per second. Elapsed-time
  motion is capped after a slow frame; high-refresh displays do not increase the
  drawing rate. No React state is updated per frame.
- The backing buffer is capped at 650,000 pixels on mobile and 1,250,000 on
  desktop, with a maximum device pixel ratio of 1.5. Geometry scales to the
  viewport without stretching athletes.
- Hidden tabs cancel the animation frame. Resuming resets frame timestamps so
  hidden time is not simulated. Reduced-motion mode draws a still frame and
  schedules no animation. Event listeners and frames are removed on unmount.
- The vector layer is displayed at 20% opacity over a dark gradient. Existing
  foreground panels, responsive navigation, inference, and API behavior remain.

Run `npm test` in `frontend/` for animation lifecycle, scheduling, viewport budget,
input passthrough, and finite geometry checks. These tests use a Canvas API stub;
they do not measure device frame rate or replace visual review in local Chrome.
