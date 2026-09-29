// Generates a deterministic, elegant SVG/DataURL album artwork based on artist and album title
const artworkCache = new Map<string, string>();

export function generateAlbumArtwork(album: string, artist: string): string {
  const key = `${album}||${artist}`;
  if (artworkCache.has(key)) {
    return artworkCache.get(key)!;
  }

  const seed = (album + artist).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  
  // Color palettes based on seed
  const gradients = [
    ['#2b5876', '#4e4376'],
    ['#003973', '#e5e5be'],
    ['#141e30', '#243b55'],
    ['#000000', '#0f9b0f'],
    ['#314755', '#26a0da'],
    ['#e1eec3', '#f05053'],
    ['#135058', '#f12711'],
    ['#1a2a6c', '#b21f1f'],
    ['#000428', '#004e92'],
    ['#3a1c71', '#d76d77'],
    ['#1d2b64', '#f8cdda'],
    ['#16222a', '#3a6073']
  ];
  
  const [c1, c2] = gradients[seed % gradients.length];
  const angle = (seed * 37) % 360;
  
  const cleanAlbum = (album || 'Unknown Album').toUpperCase();
  const cleanArtist = (artist || 'Unknown Artist').toUpperCase();
  const initial = (cleanAlbum[0] || 'A');

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
      <defs>
        <linearGradient id="g_${seed}" x1="0%" y1="0%" x2="100%" y2="100%" gradientTransform="rotate(${angle})">
          <stop offset="0%" stop-color="${c1}"/>
          <stop offset="100%" stop-color="${c2}"/>
        </linearGradient>
        <radialGradient id="vinyl_${seed}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.15"/>
          <stop offset="70%" stop-color="#000000" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0.6"/>
        </radialGradient>
      </defs>
      
      <!-- Background -->
      <rect width="400" height="400" fill="url(#g_${seed})"/>
      
      <!-- Vinyl Grooves Pattern -->
      <circle cx="200" cy="200" r="180" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="20"/>
      <circle cx="200" cy="200" r="140" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="15"/>
      <circle cx="200" cy="200" r="100" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="10"/>
      
      <!-- Vinyl overlay -->
      <rect width="400" height="400" fill="url(#vinyl_${seed})"/>
      
      <!-- Central Graphic Badge -->
      <g transform="translate(200, 190)">
        <circle r="70" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
        <text x="0" y="24" font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" font-size="72" font-weight="900" fill="#ffffff" text-anchor="middle" opacity="0.95">${initial}</text>
      </g>
      
      <!-- Text Footer -->
      <rect x="0" y="320" width="400" height="80" fill="rgba(0,0,0,0.4)"/>
      <line x1="0" y1="320" x2="400" y2="320" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
      <text x="20" y="350" font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" font-size="16" font-weight="700" fill="#ffffff" letter-spacing="1">
        ${escapeXml(cleanAlbum.slice(0, 28))}
      </text>
      <text x="20" y="375" font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" font-size="13" font-weight="500" fill="rgba(255,255,255,0.7)" letter-spacing="0.5">
        ${escapeXml(cleanArtist.slice(0, 32))}
      </text>
    </svg>
  `;

  const resultUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  artworkCache.set(key, resultUrl);
  return resultUrl;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
