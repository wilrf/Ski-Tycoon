/**
 * Hand-drawn 24×24 icons. Strokes use currentColor; fills use the --icon-fill custom property so each
 * button can tint its icon. Any element with data-icon="name" gets the matching SVG.
 */
const ICONS = {
  select: '<path d="M6 3.5 18.5 11l-5.6 1.6L10 18.5z" class="fill"/><path d="m13 13 4.5 6"/>',
  ropeTow:
    '<path d="M4 20V8M20 15V3"/><path d="M4 9 20 4"/><path d="M9 7.4v4.2M14.5 5.7v4.2"/><path d="M7.5 11.6h3M13 9.9h3" /><path d="M2.5 20h3M18.5 15h3"/>',
  chairlift:
    '<path d="M2 5.5 22 3"/><path d="M12 4.3v6.2"/><path d="M7 10.5h8.5v4.2a1.8 1.8 0 0 1-1.8 1.8H9.5" class="fill"/><path d="M7 10.5v8M16 16.5 18 20"/>',
  gondola:
    '<path d="M2 5.5 22 3"/><path d="M12 4.3V8"/><rect x="6" y="8" width="12" height="11" rx="2.5" class="fill"/><path d="M6 12.5h12M10 8v4.5M14 8v4.5"/>',
  run: '<path d="M2.5 20.5 10 6l3.5 6 2.5-3.5 5.5 12z" class="fill"/><path d="M10 6c1 4-4 6-1.5 9.5S14 17 13 20.5" stroke-dasharray="2 2.2"/>',
  pause: '<path d="M8.5 5v14M15.5 5v14"/>',
  play: '<path d="M7 4.5v15l12-7.5z" class="fill"/>',
  fast: '<path d="M3 5.5v13l8.5-6.5zM12 5.5v13l8.5-6.5z" class="fill"/>',
  fastest: '<path d="M1.5 6v12l6.5-6zM8.5 6v12l6.5-6zM15.5 6v12l6.5-6z" class="fill"/>',
  save: '<path d="M5 3.5h11l3.5 3.5v13.5h-14.5z" class="fill"/><path d="M8 3.5v5h7v-5M8 20.5v-6h8.5v6"/>',
  load: '<path d="M3 7V4.5h6l2 2.5h9.5V9" /><path d="M2.5 9h19l-2 11h-15z" class="fill"/>',
  new: '<path d="M2 20 9 8l3.5 5 2.5-3.5L22 20z" class="fill"/><path d="M18 2.5v5M15.5 5h5"/>',
  day: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5" class="fill"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5" class="fill"/><path d="M12 7v5l3.5 2"/>',
  money: '<circle cx="12" cy="12" r="8.5" class="fill"/><path d="M14.8 8.8c-.6-.9-1.6-1.3-2.8-1.3-1.6 0-2.8.8-2.8 2.1 0 3 5.8 1.6 5.8 4.7 0 1.3-1.3 2.2-3 2.2-1.3 0-2.4-.5-3-1.4M12 6v1.5M12 16.5V18"/>',
  skier: '<circle cx="15" cy="4.5" r="2" class="fill"/><path d="m3 17 18 5M13 7.5 9 11l4 2.5-2 5M13 7.5l3.5 3 3-1"/>',
  happy: '<circle cx="12" cy="12" r="8.5" class="fill"/><path d="M8.5 14c1.8 2.3 5.2 2.3 7 0M9 9.5v.5M15 9.5v.5"/>',
} as const;

export type IconName = keyof typeof ICONS;

const icon = (name: IconName): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

export function mountIcons(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    const name = el.dataset['icon'];
    if (name && name in ICONS) el.insertAdjacentHTML('afterbegin', icon(name as IconName));
  }
}
