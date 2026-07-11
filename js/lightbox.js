/**
 * Prosty lightbox — powiększenie miniatury (proxy, bez surowego IPFS).
 */
const Lightbox = (() => {
    let root;
    let img;
    let caption;

    function ensure() {
        if (root) return;
        root = document.getElementById('lightbox');
        img = document.getElementById('lightbox-image');
        caption = document.getElementById('lightbox-caption');
        if (!root) return;

        root.querySelector('.lightbox__backdrop')?.addEventListener('click', close);
        root.querySelector('.lightbox__close')?.addEventListener('click', close);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !root.hidden) close();
        });
    }

    function open({ src, alt, label }) {
        ensure();
        if (!root || !img) return;
        img.src = src;
        img.alt = alt || '';
        if (caption) caption.textContent = label || '';
        root.hidden = false;
        document.body.classList.add('lightbox-open');
    }

    function close() {
        if (!root) return;
        root.hidden = true;
        img.src = '';
        document.body.classList.remove('lightbox-open');
    }

    return { open, close };
})();