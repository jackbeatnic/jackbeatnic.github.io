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

    function open({ src, alt, label, fallbacks }) {
        ensure();
        if (!root || !img) return;
        const chain = [src, ...(fallbacks || [])].filter(Boolean);
        let i = 0;
        img.onerror = () => {
            i += 1;
            if (i < chain.length) img.src = chain[i];
        };
        img.src = chain[0] || '';
        img.alt = alt || '';
        if (caption) caption.textContent = label || '';
        root.hidden = false;
        document.body.classList.add('lightbox-open');
    }

    function close() {
        if (!root) return;
        root.hidden = true;
        if (img) {
            img.onerror = null;
            img.src = '';
        }
        document.body.classList.remove('lightbox-open');
    }

    return { open, close };
})();