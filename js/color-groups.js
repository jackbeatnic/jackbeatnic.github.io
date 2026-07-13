/**
 * Grupuje precyzyjne hexy z dominant_colors w kilka czytelnych palet filtrów.
 * Na kartach NFT zostają oryginalne kolory — tu tylko UX wyszukiwania.
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
        const rgb = parseHex(hex);
        if (!rgb) return null;
        const { h, s, l } = rgbToHsl(...rgb);

        if (l <= 18 && s < 42) return 'charcoal';
        if (s <= 12 || (l >= 88 && s <= 28)) return 'neutral';

        if (h >= 285 || h < 12) {
            if (s > 32 && l > 22 && l < 82) return 'rose';
            return 'warm';
        }
        if (h < 38) return 'warm';
        if (h < 78) return l < 42 ? 'earth' : 'green';
        if (h < 145) return l < 40 ? 'earth' : 'green';
        if (h < 215) return 'teal';
        if (h < 248) return l < 36 ? 'deep_blue' : 'blue';
        if (h < 285) return l < 42 ? 'deep_blue' : 'rose';

        return 'neutral';
    }

    function familiesForNft(nft) {
        const ids = new Set();
        (nft?.ai?.dominant_colors || []).forEach((hex) => {
            const id = familyForHex(hex);
            if (id) ids.add(id);
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
        familiesForNft,
        nftMatchesFamilies,
        labelForFamilyId,
        searchTokensForNft,
    };
})();