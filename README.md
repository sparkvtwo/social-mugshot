# Social Mugshot

A real-time photo booth app for the Social restaurant. Customers upload a photo from their phone; the server converts it to a classic B&W mugshot and instantly displays it on the restaurant's tablet screen.

## How it works

1. Customer opens `/upload` on their phone and takes a photo
2. Server processes it into a mugshot (B&W, high contrast, grain, frame + placard)
3. WebSocket pushes the result to the tablet running `/display` in kiosk mode
4. Mugshot appears full-screen instantly — no refresh needed

## Local development

```bash
npm install
node server.js
```

- Upload page: http://localhost:3000/upload
- Display page: http://localhost:3000/display

## Deploy to Railway

### Prerequisites
- [Railway CLI](https://docs.railway.app/develop/cli) installed, or use the Railway dashboard

### Steps

1. **Create a new project** in the [Railway dashboard](https://railway.app)

2. **Connect your repo** (or push directly):
   ```bash
   railway login
   railway init
   railway up
   ```

3. **Set environment variable** (optional — defaults to 3000, Railway overrides PORT automatically):
   No additional env vars required. Railway sets `PORT` automatically.

4. **Get your URL**: Railway will assign a domain like `https://social-mugshot-production.up.railway.app`

5. **Tablet setup**: Open `https://your-app.railway.app/display` in Chrome/Safari on the tablet
   - For true kiosk mode on iPad: use **Guided Access** (Settings → Accessibility → Guided Access)
   - On Android: use a kiosk browser app or Chrome's `--kiosk` flag

### Notes on storage
- Mugshots are stored in `/tmp/mugshots/` — Railway's ephemeral filesystem
- Only the last 10 mugshots are kept (auto-cleanup)
- Images are served via the same Express server

## File structure

```
social-mugshot/
├── server.js              Express + WebSocket server
├── package.json
├── railway.json           Railway deployment config
├── .env.example           Environment variable template
├── public/
│   ├── upload.html        Phone upload page (mobile-optimized)
│   └── display.html       Tablet display page (full-screen kiosk)
└── processing/
    └── mugshot.js         Sharp image processing pipeline
```

## Mugshot style

- Grayscale + high contrast (crushed blacks, bright highlights)
- Film grain overlay (soft-light blend)
- Height ruler on the left side
- Top banner: **SOCIAL POLICE DEPT.**
- Bottom placard: Booking #, charge, date
