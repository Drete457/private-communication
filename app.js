const header = document.querySelector(".site-header");
const navLinks = Array.from(document.querySelectorAll(".site-nav a"));
const topLinks = Array.from(document.querySelectorAll('a[href="#top"]'));
const canvas = document.querySelector(".hero-canvas");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const navTargets = navLinks
  .filter((link) => link.getAttribute("href")?.startsWith("#"))
  .map((link) => ({ link, section: document.querySelector(link.getAttribute("href")) }))
  .filter(({ section }) => section);

const getScrollBehavior = () => (prefersReducedMotion.matches ? "auto" : "smooth");

const scrollToPageTop = (pushHash = false) => {
  if (pushHash && window.location.hash !== "#top")
    history.pushState(null, "", "#top");

  window.scrollTo({ top: 0, left: 0, behavior: getScrollBehavior() });
};

const setHeaderState = () => {
  if (!header) return;
  header.dataset.elevated = window.scrollY > 42 ? "true" : "false";
};

const setActiveNavLink = (activeLink) => {
  navLinks.forEach((link) => {
    if (link === activeLink)
      link.setAttribute("aria-current", "location");
    else
      link.removeAttribute("aria-current");

  });
};

const updateActiveNavigation = () => {
  if (!navTargets.length) return;

  const pageBottom = document.documentElement.scrollHeight - window.innerHeight;
  if (window.scrollY >= pageBottom - 8) {
    setActiveNavLink(navTargets[navTargets.length - 1].link);
    return;
  }

  const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
  const scanY = window.scrollY + headerBottom + 40;
  const firstTargetTop = navTargets[0].section.offsetTop;

  if (scanY < firstTargetTop) {
    setActiveNavLink(null);
    return;
  }

  const activeTarget = [...navTargets]
    .reverse()
    .find(({ section }) => section.offsetTop <= scanY);

  setActiveNavLink(activeTarget?.link ?? null);
};

let navFrame = 0;

const scheduleNavigationUpdate = () => {
  cancelAnimationFrame(navFrame);
  navFrame = requestAnimationFrame(updateActiveNavigation);
};

const createHeroScene = () => {
  if (!canvas) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const reducedMotion = prefersReducedMotion;
  const nodes = [];
  let width = 0;
  let height = 0;
  let frameId = 0;

  const palette = ["#54d38a", "#ffbf5c", "#758294", "#4282ff"];

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const count = Math.max(28, Math.min(72, Math.floor(width / 18)));
    nodes.length = 0;

    for (let index = 0; index < count; index += 1) {
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.26,
        vy: (Math.random() - 0.5) * 0.26,
        radius: 1.8 + Math.random() * 2.8,
        color: palette[index % palette.length],
      });
    }
  };

  const draw = () => {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#05080d";
    context.fillRect(0, 0, width, height);

    const maxDistance = Math.min(190, Math.max(110, width / 8));

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];

      if (!reducedMotion.matches) {
        node.x += node.vx;
        node.y += node.vy;
      }

      if (node.x < -20) node.x = width + 20;
      if (node.x > width + 20) node.x = -20;
      if (node.y < -20) node.y = height + 20;
      if (node.y > height + 20) node.y = -20;

      for (let nextIndex = index + 1; nextIndex < nodes.length; nextIndex += 1) {
        const other = nodes[nextIndex];
        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const distance = Math.hypot(dx, dy);

        if (distance < maxDistance) {
          context.strokeStyle = `rgba(84, 211, 138, ${0.18 * (1 - distance / maxDistance)})`;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(node.x, node.y);
          context.lineTo(other.x, other.y);
          context.stroke();
        }
      }

      context.fillStyle = node.color;
      context.globalAlpha = 0.78;
      context.beginPath();
      context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
    }

    if (!reducedMotion.matches) 
      frameId = requestAnimationFrame(draw);
  };

  const start = () => {
    cancelAnimationFrame(frameId);
    resize();
    draw();
  };

  window.addEventListener("resize", start, { passive: true });
  reducedMotion.addEventListener?.("change", start);
  start();
};

window.addEventListener(
  "scroll",
  () => {
    setHeaderState();
    scheduleNavigationUpdate();
  },
  { passive: true },
);
window.addEventListener("resize", scheduleNavigationUpdate, { passive: true });
topLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    scrollToPageTop(true);
  });
});

if (window.location.hash === "#top") 
  requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));

setHeaderState();
updateActiveNavigation();
createHeroScene();