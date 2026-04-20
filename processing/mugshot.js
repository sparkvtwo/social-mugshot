const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const MUGSHOT_DIR = '/tmp/mugshots';
const MAX_MUGSHOTS = 10;

// Final output dimensions — classic portrait mugshot proportions
const OUT_W = 750;
const OUT_H = 1050;

// Photo area (top)
const PHOTO_W = 750;
const PHOTO_H = 780;

// Placard area (bottom)
const PLACARD_Y = PHOTO_H;
const PLACARD_H = OUT_H - PHOTO_H; // 270px

function ensureDir() {
  if (!fs.existsSync(MUGSHOT_DIR)) fs.mkdirSync(MUGSHOT_DIR, { recursive: true });
}

function cleanupOldMugshots() {
  ensureDir();
  const files = fs.readdirSync(MUGSHOT_DIR)
    .filter(f => f.endsWith('.jpg'))
    .map(f => ({ name: f, time: fs.statSync(path.join(MUGSHOT_DIR, f)).mtimeMs }))
    .sort((a, b) => a.time - b.time);
  while (files.length >= MAX_MUGSHOTS) {
    try { fs.unlinkSync(path.join(MUGSHOT_DIR, files.shift().name)); } catch {}
  }
}

function generateGrainBuffer(width, height, intensity = 22) {
  const pixels = width * height;
  const buf = Buffer.alloc(pixels);
  for (let i = 0; i < pixels; i++) {
    const u1 = Math.random() + 1e-10;
    const u2 = Math.random();
    const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    buf[i] = Math.min(255, Math.max(0, Math.round(128 + gauss * intensity)));
  }
  return buf;
}

async function processMugshot(inputPath) {
  ensureDir();
  cleanupOldMugshots();

  const bookingNum = String(Math.floor(10000 + Math.random() * 90000));
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const dateStr = `${mm} ${dd} ${yy}`;
  const dateStrFull = now.toLocaleDateString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  });

  const outputFilename = `mugshot_${Date.now()}.jpg`;
  const outputPath = path.join(MUGSHOT_DIR, outputFilename);

  // ── Step 1: Process uploaded photo ──────────────────────────────────────────
  // James Dean 1950s mugshot style: high-contrast B&W, crushed blacks, blown highlights,
  // warm silver-gelatin tone, heavy film grain.
  const processedRaw = await sharp(inputPath)
    .resize(PHOTO_W, PHOTO_H, { fit: 'cover', position: 'attention' })
    .grayscale()
    .normalise()           // stretch histogram to full range first
    .linear(1.75, -55)     // crush the blacks hard, push highlights bright
    .gamma(0.88)           // slightly brighten midtones (classic press-photo look)
    .sharpen({ sigma: 1.4, m1: 1.0, m2: 0.4 })  // crisp edges like newspaper halftone
    .raw()
    .ensureAlpha()
    .toBuffer();

  // ── Step 2: Apply heavy film grain + warm silver-gelatin tone ────────────────
  // 1950s film had pronounced grain and a slight warm (sepia-ish) base tone
  const grainBuf = generateGrainBuffer(PHOTO_W, PHOTO_H, 34); // heavier grain
  const grainRaw = await sharp(grainBuf, {
    raw: { width: PHOTO_W, height: PHOTO_H, channels: 1 }
  }).toBuffer();

  const blended = Buffer.alloc(PHOTO_W * PHOTO_H * 4);
  for (let i = 0; i < PHOTO_W * PHOTO_H; i++) {
    const base = processedRaw[i * 4];
    const g = grainRaw[i] / 255;
    let r;
    if (g < 0.5) {
      r = base - (1 - 2 * g) * base * (1 - base / 255);
    } else {
      r = base + (2 * g - 1) * (Math.sqrt(Math.max(0, base / 255)) * 255 - base);
    }
    const lum = Math.min(255, Math.max(0, Math.round(r)));
    // Warm silver-gelatin tone: slight warm push in highlights, cool shadows
    // Highlights → warm (yellowish), shadows stay near-black
    const warmFactor = lum / 255; // 0 in shadows, 1 in highlights
    const rOut = Math.min(255, Math.round(lum + warmFactor * 12)); // warm red
    const gOut = Math.min(255, Math.round(lum + warmFactor * 8));  // warm green
    const bOut = Math.min(255, Math.round(lum - warmFactor * 6));  // cool blue down
    blended[i * 4]     = rOut;
    blended[i * 4 + 1] = gOut;
    blended[i * 4 + 2] = Math.max(0, bOut);
    blended[i * 4 + 3] = 255;
  }

  const photoBuffer = await sharp(blended, {
    raw: { width: PHOTO_W, height: PHOTO_H, channels: 4 }
  }).png().toBuffer();

  // ── Step 3: Build height ruler SVG overlay for photo area ───────────────────
  // Left-side ruler marks (5'0" to 6'6" range — typical mugshot)
  const rulerMarks = [];
  const heights = [
    { label: "6'6\"", pct: 0.05 },
    { label: "6'4\"", pct: 0.12 },
    { label: "6'2\"", pct: 0.20 },
    { label: "6'0\"", pct: 0.28 },
    { label: "5'10\"", pct: 0.37 },
    { label: "5'8\"", pct: 0.46 },
    { label: "5'6\"", pct: 0.55 },
    { label: "5'4\"", pct: 0.64 },
    { label: "5'2\"", pct: 0.73 },
    { label: "5'0\"", pct: 0.82 },
  ];
  for (const h of heights) {
    const y = Math.round(h.pct * PHOTO_H);
    rulerMarks.push(`
      <line x1="0" y1="${y}" x2="28" y2="${y}" stroke="white" stroke-width="1.5" opacity="0.7"/>
      <text x="32" y="${y + 4}" font-family="Courier New, monospace" font-size="11" fill="white" opacity="0.7">${h.label}</text>
    `);
  }

  const photoOverlaySvg = `<svg width="${PHOTO_W}" height="${PHOTO_H}" xmlns="http://www.w3.org/2000/svg">
    <!-- Subtle vignette around edges -->
    <defs>
      <radialGradient id="vig" cx="50%" cy="50%" r="70%" fx="50%" fy="50%">
        <stop offset="60%" stop-color="black" stop-opacity="0"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.55"/>
      </radialGradient>
    </defs>
    <rect width="${PHOTO_W}" height="${PHOTO_H}" fill="url(#vig)"/>
    <!-- Height ruler on left -->
    ${rulerMarks.join('\n')}
  </svg>`;

  const photoOverlayBuffer = Buffer.from(photoOverlaySvg);

  // ── Step 4: Build placard SVG ──────────────────────────────────────────────
  const placardSvg = `<svg width="${OUT_W}" height="${PLACARD_H}" xmlns="http://www.w3.org/2000/svg">
    <!-- Background: dark charcoal, classic look -->
    <rect width="${OUT_W}" height="${PLACARD_H}" fill="#1a1a1a"/>

    <!-- Top divider line -->
    <line x1="0" y1="0" x2="${OUT_W}" y2="0" stroke="#555" stroke-width="2"/>

    <!-- Inner placard box -->
    <rect x="60" y="18" width="${OUT_W - 120}" height="${PLACARD_H - 36}" rx="2"
      fill="#111" stroke="#444" stroke-width="1"/>

    <!-- SOCIAL (big, centered) -->
    <text x="${OUT_W / 2}" y="70"
      font-family="Courier New, Courier, monospace"
      font-size="38" font-weight="bold"
      fill="white" text-anchor="middle" letter-spacing="8">SOCIAL</text>

    <!-- POLICE DEPT. -->
    <text x="${OUT_W / 2}" y="105"
      font-family="Courier New, Courier, monospace"
      font-size="17"
      fill="#aaa" text-anchor="middle" letter-spacing="4">POLICE DEPT.</text>

    <!-- Horizontal rule -->
    <line x1="80" y1="120" x2="${OUT_W - 80}" y2="120" stroke="#444" stroke-width="1"/>

    <!-- Date + Booking number side by side -->
    <text x="110" y="158"
      font-family="Courier New, Courier, monospace"
      font-size="13" fill="#888" letter-spacing="1">DATE</text>
    <text x="110" y="183"
      font-family="Courier New, Courier, monospace"
      font-size="20" font-weight="bold"
      fill="white" letter-spacing="3">${dateStr}</text>

    <text x="${OUT_W - 110}" y="158"
      font-family="Courier New, Courier, monospace"
      font-size="13" fill="#888" text-anchor="end" letter-spacing="1">BOOKING #</text>
    <text x="${OUT_W - 110}" y="183"
      font-family="Courier New, Courier, monospace"
      font-size="20" font-weight="bold"
      fill="white" text-anchor="end" letter-spacing="3">${bookingNum}</text>

    <!-- Divider -->
    <line x1="80" y1="198" x2="${OUT_W - 80}" y2="198" stroke="#333" stroke-width="1"/>

    <!-- CHARGE -->
    <text x="${OUT_W / 2}" y="232"
      font-family="Courier New, Courier, monospace"
      font-size="11" fill="#666" text-anchor="middle" letter-spacing="2">CHARGE</text>
    <text x="${OUT_W / 2}" y="256"
      font-family="Courier New, Courier, monospace"
      font-size="15" font-weight="bold"
      fill="#e0c060" text-anchor="middle" letter-spacing="2">PUBLIC DRUNKENNESS</text>
  </svg>`;

  const placardBuffer = await sharp(Buffer.from(placardSvg))
    .resize(OUT_W, PLACARD_H)
    .png()
    .toBuffer();

  // ── Step 5: Assemble final image ─────────────────────────────────────────────
  await sharp({
    create: {
      width: OUT_W,
      height: OUT_H,
      channels: 4,
      background: { r: 20, g: 20, b: 20, alpha: 1 }
    }
  })
    .composite([
      { input: photoBuffer, top: 0, left: 0 },
      { input: photoOverlayBuffer, top: 0, left: 0 },  // ruler + vignette on photo
      { input: placardBuffer, top: PLACARD_Y, left: 0 }, // placard at bottom
    ])
    .jpeg({ quality: 92 })
    .toFile(outputPath);

  return { outputPath, outputFilename, bookingNum, dateStr: dateStrFull };
}

module.exports = { processMugshot };
