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
        { id: 'deep_blue', label: 'Deep blue', swatch: '#1A3A5C', order: 1 },
        { id: 'blue', label: 'Blue', swatch: '#4A8FD4', order: 2 },
        { id: 'teal', label: 'Teal & aqua', swatch: '#2BB5A0', order: 3 },
        { id: 'green', label: 'Green', swatch: '#6B9E7A', order: 4 },
        { id: 'earth', label: 'Earth', swatch: '#8B7D6B', order: 5 },
        { id: 'warm', label: 'Warm', swatch: '#C9A66B', order: 6 },
        { id: 'rose', label: 'Rose & violet', swatch: '#B07A9A', order: 7 },
        { id: 'neutral', label: 'Neutral', swatch: '#E4E4E4', order: 8 },
        { id: 'charcoal', label: 'Charcoal', swatch: '#2C2C2C', order: 9 },
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

        // --- Magenta / red / rose (330–360 / 0–12) ---
        if (h >= 330 || h < 12) {
            if (s > 18 && l > 12 && l < 88) add('rose');
            // tomato / coral / burgundy warmth
            if (h < 18 || h >= 350 || (l < 40 && s > 25)) add('warm');
            if (!out.length) add(l < 28 ? 'charcoal' : 'warm');
            return out;
        }

        // --- Orange / deep red-brown (12–28) ---
        if (h < 28) {
            if (l < 38 && s > 28) add('rose'); // burgundy / deep red
            if (l < 48 && s < 58) add('earth', 'warm');
            else add('warm');
            if (!out.length) add('warm');
            return out;
        }

        // --- Gold / brown (28–48) — was wrongly green when L high ---
        if (h < 48) {
            if (l < 52 && s < 65) add('earth');
            if (s >= 30 || l >= 42) add('warm');
            if (!out.length) add('earth');
            return out;
        }

        // --- Olive / khaki (48–70) ---
        if (h < 70) {
            if (s < 32 && l < 52) add('earth');
            else add('green');
            if (h >= 58 && s >= 22) add('green');
            if (!out.length) add('earth');
            return out;
        }

        // --- True greens incl. dark forest / emerald (70–150) ---
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

        // --- Indigo / violet ---
        if (h < 295) {
            if (l < 48) add('deep_blue');
            if (s > 22 && l > 22) add('rose');
            if (!out.length) add('deep_blue');
            return out;
        }

        // --- Magenta (295–330) ---
        add('rose');
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
            .sort((a, b) => b.count - a.count || a.order - b.order);
    }

    function nftMatchesFamilies(nft, activeFamilyIds) {
        if (!activeFamilyIds?.size) return true;
        const nftFamilies = familiesForNft(nft);
        return nftFamilies.some((id) => activeFamilyIds.has(id));
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
