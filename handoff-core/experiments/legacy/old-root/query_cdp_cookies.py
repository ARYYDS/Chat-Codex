import json
import urllib.request
import urllib.parse
import asyncio
import websockets

async def get_cookies():
    # Get browser websocket URL
    req = urllib.request.urlopen("http://127.0.0.1:9222/json/version")
    data = json.loads(req.read().decode())
    ws_url = data["webSocketDebuggerUrl"]
    
    async with websockets.connect(ws_url) as ws:
        msg = {"id": 1, "method": "Storage.getCookies"}
        await ws.send(json.dumps(msg))
        resp = await ws.recv()
        data = json.loads(resp)
        cookies = data.get("result", {}).get("cookies", [])
        print(f"Total cookies in running slim Chrome: {len(cookies)}")
        for c in cookies:
            if "chatgpt" in c["domain"] or "openai" in c["domain"] or "claude" in c["domain"]:
                print(f"Domain: {c['domain']}, Name: {c['name']}")

asyncio.run(get_cookies())
