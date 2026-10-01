/**
 * Cloudflare Worker — IPFS thumbnail proxy (later phase)
 *
 * Deploy (short):
 *   1. cloudflare.com → Workers → Create Worker
 *   2. Paste this code → Deploy
 *   3. Route: img.your-domain.com/*  (or a workers.dev URL for testing)
 *   4. In js/images.js set CLOUDFLARE_WORKER_BASE to that URL
 *   5. In js/gallery.js change IMAGE_PROXY to 'cloudflare'
 *
 * GET parameters:
 *   url  — full image URL (e.g. https://ipfs.io/ipfs/CID...)
 *   w, h — optional; the Worker forwards them to images.weserv.nl (resize)
 *
 * The original CID never reaches the page HTML — only the Worker URL.
 */
const ALLOWED_HOSTS = [
  'ipfs.io',
  'gateway.pinata.cloud',
  'cloudflare-ipfs.com',
  'dweb.link',
  'arweave.net',
];

export default {
  async fetch(request) {
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    const { searchParams } = new URL(request.url);
    const target = searchParams.get('url');
    const w = searchParams.get('w') || '560';
    const h = searchParams.get('h') || '420';
    const fit = searchParams.get('fit') || 'inside';

    if (!target) {
      return new Response('Missing url parameter', { status: 400 });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response('Invalid url', { status: 400 });
    }

    if (!ALLOWED_HOSTS.some((host) => targetUrl.hostname.endsWith(host))) {
      return new Response('Host not allowed', { status: 403 });
    }

    const proxy = new URL('https://images.weserv.nl/');
    proxy.searchParams.set('url', target);
    proxy.searchParams.set('w', w);
    proxy.searchParams.set('h', h);
    proxy.searchParams.set('fit', fit);
    proxy.searchParams.set('output', 'webp');
    proxy.searchParams.set('q', '82');
    proxy.searchParams.set('n', '-1');

    const upstream = await fetch(proxy.toString(), {
      headers: { 'User-Agent': 'JackBeatnicGallery/1.0' },
    });

    if (!upstream.ok) {
      return new Response('Upstream error', { status: 502 });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'image/webp',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    });
  },
};