// SautiLink's existing appeals SVG, animated with the shared icon engine.
const icon = {
  name: 'justice-scale', library: 'sautilink', tag: 'svg',
  attrs: {
    xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  },
  children: [
    { tag: 'path', attrs: { d: 'M12 3v18M7 21h10' } },
    {
      tag: 'g', normal: { rotate: 0 },
      animate: { rotate: [0, -5, 5, -2, 0], transition: { duration: .7, ease: 'easeInOut' } },
      style: { transformBox: 'view-box', originX: '12px', originY: '12px' },
      children: [{ tag: 'path', attrs: { d: 'M5 7h14M7 7l-3 6h6L7 7ZM17 7l-3 6h6l-3-6Z' } }],
    },
  ],
};
export { icon as a };
