// Line icons (24×24, stroke = currentColor). Static markup only: never built from data.
export const ICONS = {
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  clipboard: '<rect x="5" y="4.5" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 14h7M8.5 18h4"/>',
  capsule: '<rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-40 12 12)"/><path d="M9.6 9.2l4.8 5.6"/>',
  chart: '<path d="M4 20.5h16M7 17v-6M12 17V6.5M17 17v-3.5"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>',
  chat: '<path d="M4.5 5.5h15v10.5h-8l-4.5 3.5V16h-2.5z"/><path d="M8.5 9.5h7M8.5 12.5h4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4.5 19.5l1-4L15.5 5.5l3 3-10 10z"/><path d="M13.5 7.5l3 3"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  'x-circle': '<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  send: '<path d="M4 12l16-7.5-5.5 16-3-6.5z"/><path d="M11.5 14l3.5-3.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  logout: '<path d="M14 4.5H6.5a2 2 0 00-2 2v11a2 2 0 002 2H14M10 12h10M16.5 8.5L20 12l-3.5 3.5"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
};
export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', ('icon ' + cls).trim());
  svg.innerHTML = ICONS[name] || '';
  return svg;
}
