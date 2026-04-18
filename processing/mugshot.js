const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const MUGSHOT_DIR = '/tmp/mugshots';
const MAX_MUGSHOTS = 10;

function ensureDir() {
  if (!fs.existsSync(MUGSHOT_DIR)) {
    fs.mkdirSync(MUGSHOT_DIR, { recursive: true });
  }
}

function cleanupOldMugshots() {
  ensureDir();
  const files = fs.readdirSync(MUGSHOT_DIR)
    .filter(f => f.endsWith('.jpg'))
    .map(f => ({ name: f, time: fs.statSync(path.join(MUGSHOT_DIR, f)).mtimeMs }))
    .sort((a, b) => a.time - b.time);

  while (files.length >= MAX_MUGSHOTS) {
    const oldest = files.shift();
    try { fs.unlinkSync(path.join(MUGSHOT_DIR, oldest.name)); } catch {}
  }
}

// Generate film grain as a raw pixel buffer
function generateGrainBuffer(width, height, intensity = 35) {
  const pixels = width * height;
  const buf = Buffer.alloc(pixels);
  for (let i = 0; i < pixels; i++) {
    // gaussian-ish noise via two uniforms
    const u1 = Math.random();
    const u2 = Math.random();
    const gauss = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
    buf[i] = Math.min(255, Math.max(0, Math.round(128 + gauss * intensity)));
  }
  return buf;
}

async function processMugshot(inputPath) {
  ensureDir();
  cleanupOldMugshots();

  const bookingNum = String(Math.floor(100000 + Math.random() * 900000));
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-');

  const outputFilename = `mugshot_${Date.now()}.jpg`;
  const outputPath = path.join(MUGSHOT_DIR, outputFilename);

  // Get input image metadata
  const meta = await sharp(inputPath).metadata();
  const targetWidth = 800;
  const targetHeight = 1000;

  // --- Step 1: resize + grayscale + high contrast ---
  const baseProcessed = await sharp(inputPath)
    .resize(targetWidth, targetHeight, { fit: 'cover', position: 'top' })
    .grayscale()
    .normalise()
    // High contrast: S-curve via linear + gamma
    .linear(1.4, -30)   // boost contrast
    .gamma(1.15)         // slightly crush shadows
    .sharpen({ sigma: 1.2 })
    .toBuffer();

  // --- Step 2: blend film grain ---
  const grainBuf = generateGrainBuffer(targetWidth, targetHeight, 28);
  const grainImage = sharp(grainBuf, {
    raw: { width: targetWidth, height: targetHeight, channels: 1 }
  }).toBuffer();

  const [baseRaw, grainRaw] = await Promise.all([
    sharp(baseProcessed).raw().ensureAlpha().toBuffer(),
    grainImage
  ]);

  // Soft-light blend grain onto image
  const blended = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let i = 0; i < targetWidth * targetHeight; i++) {
    const baseVal = baseRaw[i * 4];
    const g = grainRaw[i] / 255;
    // Soft-light formula: gentle overlay
    let result;
    if (g < 0.5) {
      result = baseVal - (1 - 2 * g) * baseVal * (1 - baseVal / 255);
    } else {
      result = baseVal + (2 * g - 1) * (Math.sqrt(baseVal / 255) * 255 - baseVal);
    }
    const clamped = Math.min(255, Math.max(0, Math.round(result)));
    blended[i * 4] = clamped;
    blended[i * 4 + 1] = clamped;
    blended[i * 4 + 2] = clamped;
    blended[i * 4 + 3] = 255;
  }

  const grainedBuffer = await sharp(blended, {
    raw: { width: targetWidth, height: targetHeight, channels: 4 }
  }).jpeg({ quality: 92 }).toBuffer();

  // --- Step 3: build SVG frame overlay ---
  const frameThickness = 28;
  const placardHeight = 110;
  const totalWidth = targetWidth + frameThickness * 2;
  const totalHeight = targetHeight + frameThickness * 2 + placardHeight + 44; // 44px for top text

  const svgOverlay = `<svg width="${totalWidth}" height="${totalHeight}" xmlns="http://www.w3.org/2000/svg">
  <!-- white background / frame -->
  <rect width="${totalWidth}" height="${totalHeight}" fill="white"/>

  <!-- photo cutout will be composited in the middle -->

  <!-- top banner -->
  <rect x="0" y="0" width="${totalWidth}" height="44" fill="#111"/>
  <text x="${totalWidth / 2}" y="30"
    font-family="Courier New, Courier, monospace"
    font-size="20" font-weight="bold"
    fill="white" text-anchor="middle" letter-spacing="4">
    SOCIAL POLICE DEPT.
  </text>

  <!-- bottom placard -->
  <rect x="${frameThickness}" y="${44 + frameThickness + targetHeight}"
        width="${targetWidth}" height="${placardHeight}" fill="#111"/>

  <!-- placard lines -->
  <text x="${frameThickness + 18}" y="${44 + frameThickness + targetHeight + 34}"
    font-family="Courier New, Courier, monospace"
    font-size="17" font-weight="bold"
    fill="white" letter-spacing="1">
    BOOKING #: ${bookingNum}
  </text>
  <text x="${frameThickness + 18}" y="${44 + frameThickness + targetHeight + 62}"
    font-family="Courier New, Courier, monospace"
    font-size="15" font-weight="bold"
    fill="white" letter-spacing="1">
    CHARGE: PUBLIC DRUNKENNESS
  </text>
  <text x="${frameThickness + 18}" y="${44 + frameThickness + targetHeight + 90}"
    font-family="Courier New, Courier, monospace"
    font-size="14"
    fill="#ccc" letter-spacing="1">
    DATE: ${dateStr}
  </text>

  <!-- left height ruler marks -->
  ${[...Array(11)].map((_, i) => {
    const yPos = 44 + frameThickness + Math.round((targetHeight / 10) * i);
    const feet = Math.floor((60 + (10 - i) * 6) / 12);
    const inches = (60 + (10 - i) * 6) % 12;
    const label = i % 2 === 0 ? `${feet}'${inches}"` : '';
    return `<line x1="0" y1="${yPos}" x2="${frameThickness}" y2="${yPos}" stroke="white" stroke-width="1.5"/>
    ${label ? `<text x="2" y="${yPos - 3}" font-family="Courier New, monospace" font-size="9" fill="white">${label}</text>` : ''}`;
  }).join('\n')}
</svg>`;

  const svgBuffer = Buffer.from(svgOverlay);

  // --- Step 4: composite: frame + photo in correct position ---
  await sharp({
    create: {
      width: totalWidth,
      height: totalHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
    .composite([
      // SVG frame
      { input: svgBuffer, top: 0, left: 0 },
      // Photo in the frame
      { input: grainedBuffer, top: 44 + frameThickness, left: frameThickness }
    ])
    .jpeg({ quality: 90 })
    .toFile(outputPath);

  return { outputPath, outputFilename, bookingNum, dateStr };
}

module.exports = { processMugshot };
