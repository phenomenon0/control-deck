/* Control Deck Explainer — scroll-spy for the sticky nav. */
(function () {
  "use strict";

  const links = Array.from(document.querySelectorAll(".jump a"));
  const sections = links
    .map(a => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);

  if (!("IntersectionObserver" in window) || !sections.length) return;

  const byId = new Map(links.map(a => [a.getAttribute("href").slice(1), a]));
  const io = new IntersectionObserver(
    entries => {
      entries.forEach(e => {
        const link = byId.get(e.target.id);
        if (!link) return;
        if (e.isIntersecting) {
          links.forEach(l => l.classList.remove("active"));
          link.classList.add("active");
        }
      });
    },
    { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
  );
  sections.forEach(s => io.observe(s));
})();
