require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { processMugshot } = require('./processing/mugshot');

const PORT = process.env.PORT || 3000;
const UPLOAD_TMP = '/tmp/uploads';

// Ensure upload temp dir exists
if (!fs.existsSync(UPLOAD_TMP)) fs.mkdirSync(UPLOAD_TMP, { recursive: true });

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ---- Multer upload config ----
const storage = multer.diskStorage({
  destination: UPLOAD_TMP,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `upload_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// ---- Static files ----
app.use(express.static(path.join(__dirname, 'public')));
app.use('/mugshots', express.static('/tmp/mugshots'));

// ---- Routes ----
app.get('/', (req, res) => res.redirect('/upload'));

app.get('/upload', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

app.post('/upload', upload.single('photo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const inputPath = req.file.path;

  try {
    const result = await processMugshot(inputPath);

    // Clean up tmp upload
    try { fs.unlinkSync(inputPath); } catch {}

    // Broadcast to all display clients
    const imageUrl = `/mugshots/${result.outputFilename}`;
    const message = JSON.stringify({
      type: 'new_mugshot',
      imageUrl,
      bookingNum: result.bookingNum,
      dateStr: result.dateStr
    });

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });

    res.json({ success: true, imageUrl });
  } catch (err) {
    console.error('Processing error:', err);
    try { fs.unlinkSync(inputPath); } catch {}
    res.status(500).json({ error: 'Failed to process image' });
  }
});

// ---- WebSocket ----
wss.on('connection', (ws) => {
  console.log('Display client connected');
  ws.on('close', () => console.log('Display client disconnected'));
  ws.on('error', (err) => console.error('WS error:', err));
});

// ---- Start ----
server.listen(PORT, () => {
  console.log(`Social Mugshot running at http://localhost:${PORT}`);
  console.log(`  Upload page: http://localhost:${PORT}/upload`);
  console.log(`  Display page: http://localhost:${PORT}/display`);
});
