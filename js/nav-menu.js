/* Mobile top-nav hamburger (redesign 2026-10-01).
   Only toggles a class; the links/chips inside keep their own handlers
   (sections.js / tip.js / shop chip / Featured chip). */
(function () {
    'use strict';
    var MQ = window.matchMedia('(max-width: 768px)');
    function init() {
        var btn = document.getElementById('nav-toggle');
        var menu = document.getElementById('site-menu');
        var header = btn && btn.closest('.site-header');
        if (!btn || !menu || !header) return;
        function set(open) {
            header.classList.toggle('is-menu-open', open);
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            btn.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
        }
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            set(!header.classList.contains('is-menu-open'));
        });
        // Close after choosing an item (let the item's own handler run first).
        menu.addEventListener('click', function (e) {
            if (!MQ.matches) return;
            if (e.target.closest('a, button')) setTimeout(function () { set(false); }, 0);
        });
        document.addEventListener('click', function (e) {
            if (header.classList.contains('is-menu-open') && !header.contains(e.target)) set(false);
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && header.classList.contains('is-menu-open')) { set(false); btn.focus(); }
        });
        var onMq = function () { if (!MQ.matches) set(false); };
        if (MQ.addEventListener) MQ.addEventListener('change', onMq); else if (MQ.addListener) MQ.addListener(onMq);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
