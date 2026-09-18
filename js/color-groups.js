/**
 * Grupuje precyzyjne hexy z dominant_colors w kilka czytelnych palet filtrów.
 * Na kartach NFT zostają oryginalne kolory — tu tylko UX wyszukiwania.
 *
 * 2026-09-07: bucketing is perception-first for ALL families (not only green).
 * - Dark chromatic hues stay on their family (not dumped to charcoal/earth).
 * - Border hues may match two adjacent chips so filters catch what eyes see.
 * - Browns/golds land on earth/warm; forest greens on green; navy on blue+deep_blue.
 */
const GalleryColorGroups = (() => {
    const FAMILIES = [
        { id: 'red', label: 'Red', swatch: '#C44536', order: 1 },
        { id: 'orange', label: 'Orange', swatch: '#E07A3D', order: 2 },
        { id: 'yellow', label: 'Yellow', swatch: '#E4C441', order: 3 },
        { id: 'warm', label: 'Gold', swatch: '#C9A66B', order: 4 },
        { id: 'earth', label: 'Earth', swatch: '#8B7D6B', order: 5 },
        { id: 'green', label: 'Green', swatch: '#6B9E7A', order: 6 },
        { id: 'teal', label: 'Teal', swatch: '#2BB5A0', order: 7 },
        { id: 'blue', label: 'Blue', swatch: '#4A8FD4', order: 8 },
        { id: 'deep_blue', label: 'Deep blue', swatch: '#1A3A5C', order: 9 },
        { id: 'purple', label: 'Purple', swatch: '#7B5EA7', order: 10 },
        { id: 'rose', label: 'Rose', swatch: '#B07A9A', order: 11 },
        { id: 'neutral', label: 'Neutral', swatch: '#E4E4E4', order: 12 },
        { id: 'charcoal', label: 'Charcoal', swatch: '#2C2C2C', order: 13 },
    ];

    const BY_ID = Object.fromEntries(FAMILIES.map((f) => [f.id, f]));

    function parseHex(hex) {
        const clean = String(hex || '')
            .trim()
            .replace(/^#/, '');
        if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return null;
        return [
            parseInt(clean.slice(0, 2), 16),
            parseInt(clean.slice(2, 4), 16),
            parseInt(clean.slice(4, 6), 16),
        ];
    }

    function rgbToHsl(r, g, b) {
        const rn = r / 255;
        const gn = g / 255;
        const bn = b / 255;
        const max = Math.max(rn, gn, bn);
        const min = Math.min(rn, gn, bn);
        const l = (max + min) / 2;
        if (max === min) return { h: 0, s: 0, l: l * 100 };
        const d = max - min;
        const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        let h;
        if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        else if (max === gn) h = ((bn - rn) / d + 2) / 6;
        else h = ((rn - gn) / d + 4) / 6;
        return { h: h * 360, s: s * 100, l: l * 100 };
    }

    function familyForHex(hex) {
        const ids = familiesForHex(hex);
        return ids[0] || null;
    }

    /**
     * One or more filter families for a hex. Borders may dual-tag so a chip
     * click matches human color reading (Jack: green was only an example —
     * every family must not swallow neighbors' works).
     */
    function familiesForHex(hex) {
        const rgb = parseHex(hex);
        if (!rgb) return [];
        const { h, s, l } = rgbToHsl(...rgb);
        const out = [];
        const add = (...ids) => {
            ids.forEach((id) => {
                if (!out.includes(id)) out.push(id);
            });
        };

        // Absolute chroma (max-min RGB) — HSL saturation blows up near white/black
        const chroma = Math.max(...rgb) - Math.min(...rgb);

        // Near-black grey only — keep dark chromatics on their hue family
        if (l <= 12 && (s < 28 || chroma < 22)) return ['charcoal'];
        if (l <= 16 && s < 18 && chroma < 18) return ['charcoal'];

        // True greys / near-white: use chroma, not HSL s (e.g. #F4F7F9 s≈29% but chroma 5)
        if (chroma <= 14) return ['neutral'];
        if (l >= 90 && chroma <= 22) return ['neutral'];
        if (s <= 8 && chroma <= 28) return ['neutral'];

        // --- Red (350–12) ---
        if (h >= 350 || h < 12) {
            if (s > 22 && l > 14 && l < 72) add('red');
            if (l > 42 && s > 18) add('rose');
            if (h < 10 && l < 42 && s > 28) add('warm');
            if (!out.length) add(l < 28 ? 'charcoal' : 'red');
            return out;
        }

        // --- Orange / coral (12–38) ---
        if (h < 38) {
            if (s >= 32 && l >= 28) add('orange');
            if (l < 40 && s > 28) add('red');
            if (l < 50 && s < 55) add('earth', 'warm');
            else add('warm');
            if (!out.length) add('orange');
            return out;
        }

        // --- Gold / yellow / brown (38–58) ---
        if (h < 58) {
            if (l >= 48 && s >= 35) add('yellow');
            if (l < 55 && s < 70) add('earth');
            if (s >= 28 || l >= 40) add('warm');
            if (h >= 50 && s >= 28) add('yellow');
            if (!out.length) add('earth');
            return out;
        }

        // --- Olive / lime / yellow-green (58–78) ---
        if (h < 78) {
            if (l >= 50 && s >= 40 && h < 70) add('yellow');
            if (s < 32 && l < 52) add('earth');
            else add('green');
            if (h >= 62 && s >= 22) add('green');
            if (!out.length) add('earth');
            return out;
        }

        // --- True greens incl. dark forest / emerald (78–150) ---
        if (h < 150) {
            if (h < 95 && s < 24 && l < 42) add('earth');
            else add('green');
            return out;
        }

        // --- Green ↔ teal border ---
        if (h < 168) {
            add('green', 'teal');
            return out;
        }

        // --- Teal / aqua ---
        if (h < 195) {
            add('teal');
            if (h >= 185) add('blue');
            return out;
        }

        // --- Sky / cyan-blue ---
        if (h < 225) {
            add('blue');
            if (h < 210) add('teal');
            if (l < 42) add('deep_blue');
            return out;
        }

        // --- Blue / navy ---
        if (h < 255) {
            if (l < 45) add('deep_blue');
            if (l >= 32) add('blue');
            if (!out.length) add('deep_blue');
            return out;
        }

        // --- Indigo / violet / purple ---
        if (h < 310) {
            add('purple');
            if (l < 48) add('deep_blue');
            if (h >= 290 && s > 22 && l > 28) add('rose');
            if (!out.length) add('purple');
            return out;
        }

        // --- Magenta / pink (310–350) ---
        add('rose');
        if (h < 330 && s > 28) add('purple');
        if (l < 36) add('deep_blue');
        return out;
    }

    function familiesForNft(nft) {
        const ids = new Set();
        (nft?.ai?.dominant_colors || []).forEach((hex) => {
            familiesForHex(hex).forEach((id) => ids.add(id));
        });
        return [...ids];
    }

    function familiesPresent(nfts) {
        const counts = new Map();
        (nfts || []).forEach((nft) => {
            const seen = new Set();
            familiesForNft(nft).forEach((id) => {
                if (seen.has(id)) return;
                seen.add(id);
                counts.set(id, (counts.get(id) || 0) + 1);
            });
        });

        return FAMILIES.filter((f) => counts.has(f.id))
            .map((f) => ({ ...f, count: counts.get(f.id) }))
            .sort((a, b) => a.order - b.order);
    }

    /**
     * AND across selected palette chips: NFT must include EVERY active family
     * (intersection / narrow-down). Vibes already use every(); colors used to OR.
     * Jack 2026-09-07: selecting green+rose+tags should cross-filter, not sum.
     */
    function nftMatchesFamilies(nft, activeFamilyIds) {
        if (!activeFamilyIds?.size) return true;
        const nftFamilies = new Set(familiesForNft(nft));
        return [...activeFamilyIds].every((id) => nftFamilies.has(id));
    }

    function labelForFamilyId(id) {
        return BY_ID[id]?.label || id;
    }

    function searchTokensForNft(nft) {
        return familiesForNft(nft).map((id) => labelForFamilyId(id).toLowerCase());
    }

    return {
        familiesPresent,
        familyForHex,
        familiesForHex,
        familiesForNft,
        nftMatchesFamilies,
        labelForFamilyId,
        searchTokensForNft,
    };
})();
