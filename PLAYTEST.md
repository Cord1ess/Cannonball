# Cannonball — play with friends (no deploy)

Two ways in: **same Wi-Fi (LAN)** is easiest; **tunnel** works from anywhere.
You (the host) run the server + client; friends just open a link.

---

## Everyone: one-time setup

```bash
git clone <repo-url>
cd Cannonball
npm install
```

That's it — no build step needed for playtesting.

---

## Option A — same Wi-Fi (LAN), simplest

**Host:**

1. Find your LAN IP:
   - Windows: `ipconfig` → "IPv4 Address" (e.g. `192.168.1.5`)
2. Start both servers (two terminals):
   ```bash
   npm run dev:server     # game server on :2567
   npm run dev:client     # client on :5173 (now bound to all interfaces)
   ```
3. Share this URL with friends (swap in your IP):
   ```
   http://192.168.1.5:5173/?server=192.168.1.5:2567
   ```

**Friends:** open that link in a browser. Done — you land straight in the lobby.
The host clicks **START MATCH** when everyone's in (or adds bots to fill).

---

## Option B — tunnel (play from anywhere)

You need to expose **two** ports: the client (5173) and the server (2567).
Cloudflare's quick tunnel is free and needs no account.

**Host:**

1. Install cloudflared once:
   - Windows: `winget install --id Cloudflare.cloudflared`
2. Start both dev servers:
   ```bash
   npm run dev:server
   npm run dev:client
   ```
3. In two more terminals, open a tunnel for each:
   ```bash
   cloudflared tunnel --url http://localhost:2567     # -> SERVER url
   cloudflared tunnel --url http://localhost:5173     # -> CLIENT url
   ```
   Each prints a `https://something.trycloudflare.com` URL.
4. Build the share link — CLIENT url, with the SERVER url in `?server=`:
   ```
   https://<CLIENT>.trycloudflare.com/?server=https://<SERVER>.trycloudflare.com
   ```
   (The client auto-converts `https://` → `wss://` for you.)

**Friends:** open that one link. Straight into the lobby.

> ngrok works too (`ngrok http 2567` and `ngrok http 5173`) — same idea, paste
> both URLs into the share link.

---

## If a friend can't connect

They'll see a red bar at the top with a **text box** — paste the host's SERVER
address there (the `?server=` value, e.g. `https://xxx.trycloudflare.com` or
`192.168.1.5:2567`) and hit **connect**. It's remembered for next time.

## Notes

- The server address a friend uses is saved locally, so reloads keep working.
- Add `?fresh` to force a brand-new room; `?dev` drops you into an instant
  bot-filled arena (for solo testing, not group play).
- Rounds are tuned longer for playtesting right now (10s × survivors per tick).
