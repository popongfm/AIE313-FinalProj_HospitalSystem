// Motion for the public pages: scroll reveal, aurora parallax and the pointer spotlight on glass cards.
// Presentation only. css/app.css hides [data-reveal] elements only while <html> has .js-motion, which the inline
// script in <head> adds (and removes again if this module never runs), so content is never stuck invisible.
const root = document.documentElement;
window.__motion = true;

const targets = document.querySelectorAll('[data-reveal]');
if (root.classList.contains('js-motion') && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  targets.forEach((el) => io.observe(el));
} else targets.forEach((el) => el.classList.add('in'));

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches, fine = matchMedia('(pointer: fine)').matches;
if (!calm && fine) {
  // aurora: the colour fields lean a little towards the pointer (--px / --py run from -1 to 1)
  const aurora = document.querySelector('.aurora');
  let queued = false;
  if (aurora) addEventListener('pointermove', (e) => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      aurora.style.setProperty('--px', (e.clientX / innerWidth * 2 - 1).toFixed(3));
      aurora.style.setProperty('--py', (e.clientY / innerHeight * 2 - 1).toFixed(3));
      queued = false;
    });
  }, { passive: true });
  // spotlight: a soft highlight follows the pointer across [data-glow] surfaces
  document.querySelectorAll('[data-glow]').forEach((el) => el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--gx', `${e.clientX - r.left}px`); el.style.setProperty('--gy', `${e.clientY - r.top}px`);
  }, { passive: true }));
}
