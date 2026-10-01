/* Hero A demo only: transparent header over the hero, the live frosted sticky
   header after ~80% of the hero height has scrolled by. */
(function () {
    'use strict';
    function init() {
        var header = document.getElementById('site-header');
        var hero = document.querySelector('.hero--a');
        if (!header || !hero) return;
        var ticking = false;
        function update() {
            ticking = false;
            var solid = window.scrollY > hero.offsetHeight * 0.8;
            header.classList.toggle('is-solid', solid);
        }
        function onScroll() {
            if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
        }
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        update();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
