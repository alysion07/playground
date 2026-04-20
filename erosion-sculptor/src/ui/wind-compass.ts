// Small SVG compass that shows the current wind yaw + strength in the top
// right, adjacent to the tweakpane panel. Rebuilds the arrow transform and
// bar length on every store change — cheap because it's just attribute
// writes on a handful of SVG elements, no DOM reconstruction after the
// initial mount.
//
// The compass is purely a visualization. All behaviour (β, yaw, viz) is
// driven by the store. The element itself is `pointer-events: none` so it
// never steals interaction from the canvas underneath.

import { appStore } from '../state/store';
import type { WindParams } from '../state/types';

const NS = 'http://www.w3.org/2000/svg';

// Max β value the bar represents at full length. Matches the tweakpane
// slider cap so a maxed-out slider fills the bar. Not a hard clamp —
// larger β just caps the visible bar at 100%.
const BETA_MAX = 1.2;

export function mountWindCompass(host: HTMLElement): () => void {
  host.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 80 80');
  svg.setAttribute('width', '80');
  svg.setAttribute('height', '80');
  svg.style.display = 'block';

  // Dial: dark circle with a subtle stroke. Radius 32 gives ~4px margin to
  // the edge of the 80×80 host so the arrow tip never clips.
  const dial = document.createElementNS(NS, 'circle');
  dial.setAttribute('cx', '40');
  dial.setAttribute('cy', '40');
  dial.setAttribute('r', '32');
  dial.setAttribute('fill', 'rgba(10, 10, 15, 0.55)');
  dial.setAttribute('stroke', 'rgba(255, 255, 255, 0.28)');
  dial.setAttribute('stroke-width', '1');
  svg.appendChild(dial);

  // N/E/S/W tick marks. Not labeled — the shape is the information.
  for (let i = 0; i < 4; i++) {
    const tick = document.createElementNS(NS, 'line');
    const a = (i * Math.PI) / 2;
    const x1 = 40 + Math.cos(a) * 30;
    const y1 = 40 + Math.sin(a) * 30;
    const x2 = 40 + Math.cos(a) * 34;
    const y2 = 40 + Math.sin(a) * 34;
    tick.setAttribute('x1', String(x1));
    tick.setAttribute('y1', String(y1));
    tick.setAttribute('x2', String(x2));
    tick.setAttribute('y2', String(y2));
    tick.setAttribute('stroke', 'rgba(255, 255, 255, 0.4)');
    tick.setAttribute('stroke-width', '1');
    svg.appendChild(tick);
  }

  // Arrow is a group rotated around the center. Group origin matches the
  // dial center so rotate(yaw, 40, 40) works out to just `rotate(yaw)` on
  // a group whose children are centered on 0,0. We use the transform form
  // anyway for readability.
  const arrowGroup = document.createElementNS(NS, 'g');
  const arrow = document.createElementNS(NS, 'path');
  arrow.setAttribute('d', 'M -18 0 L 14 0 M 14 0 L 8 -6 M 14 0 L 8 6');
  arrow.setAttribute('stroke', '#e06055');
  arrow.setAttribute('stroke-width', '2.5');
  arrow.setAttribute('stroke-linecap', 'round');
  arrow.setAttribute('fill', 'none');
  arrowGroup.appendChild(arrow);
  arrowGroup.setAttribute('transform', 'translate(40, 40)');
  svg.appendChild(arrowGroup);

  // Strength bar under the dial: background track + fill. Width updates as
  // a fraction of BETA_MAX. Keeps the component honest when β is large.
  const barTrack = document.createElementNS(NS, 'rect');
  barTrack.setAttribute('x', '14');
  barTrack.setAttribute('y', '74');
  barTrack.setAttribute('width', '52');
  barTrack.setAttribute('height', '3');
  barTrack.setAttribute('rx', '1');
  barTrack.setAttribute('fill', 'rgba(255, 255, 255, 0.15)');
  svg.appendChild(barTrack);

  const barFill = document.createElementNS(NS, 'rect');
  barFill.setAttribute('x', '14');
  barFill.setAttribute('y', '74');
  barFill.setAttribute('height', '3');
  barFill.setAttribute('rx', '1');
  barFill.setAttribute('fill', '#e06055');
  svg.appendChild(barFill);

  host.appendChild(svg);

  const apply = (wind: WindParams): void => {
    // yaw is measured counter-clockwise from +x in the shader; SVG rotate
    // is clockwise in screen space, and SVG +y goes *down*. These two
    // inversions cancel, so we can use yaw directly (in degrees) here.
    // elevation isn't visualized — a pure top-down compass only shows yaw.
    const deg = (wind.yaw * 180) / Math.PI;
    arrowGroup.setAttribute('transform', `translate(40, 40) rotate(${deg})`);
    const pct = Math.min(1, Math.max(0, wind.beta / BETA_MAX));
    barFill.setAttribute('width', String(52 * pct));
    // Hide entirely when viz is off — keeps the UI consistent with the
    // surface-pressure overlay which also disappears.
    host.style.opacity = wind.viz ? '1' : '0.25';
  };

  apply(appStore.getState().wind);
  const unsubscribe = appStore.subscribe((state, prev) => {
    if (state.wind !== prev.wind) apply(state.wind);
  });

  return () => {
    unsubscribe();
    host.innerHTML = '';
  };
}
