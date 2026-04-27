from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import uuid
import json
import os
from datetime import datetime

# Dosya yollarını kesinleştir
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = FastAPI(title="Dege Video Chat")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

rooms: dict[str, dict[str, WebSocket]] = {}

# Spesifik Statik Dosya Rotaları (Render'da path hatalarını önlemek için)
@app.get("/style.css")
async def get_style():
    return FileResponse(os.path.join(STATIC_DIR, "style.css"))

@app.get("/app.js")
async def get_js():
    return FileResponse(os.path.join(STATIC_DIR, "app.js"))

@app.get("/")
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/room/{room_id}")
async def room(room_id: str):
    return FileResponse(os.path.join(STATIC_DIR, "room.html"))

@app.post("/create-room")
async def create_room():
    room_id = uuid.uuid4().hex[:8]
    return {"room_id": room_id}

# WebSocket
@app.websocket("/ws/{room_id}/{username}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, username: str):
    await websocket.accept()
    if room_id not in rooms:
        rooms[room_id] = {}
    if username in rooms[room_id]:
        await websocket.send_json({"type": "error", "message": "This username is already taken in this room!"})
        await websocket.close()
        return
    rooms[room_id][username] = websocket
    existing_users = [u for u in rooms[room_id] if u != username]
    await websocket.send_json({"type": "existing-users", "users": existing_users})
    for user, ws in rooms[room_id].items():
        if user != username:
            try:
                await ws.send_json({"type": "user-joined", "username": username})
            except: pass

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            if data["type"] == "chat":
                timestamp = datetime.now().strftime("%H:%M")
                for user, ws in rooms[room_id].items():
                    try:
                        await ws.send_json({"type": "chat", "username": username, "message": data["message"], "timestamp": timestamp})
                    except: pass
            elif data["type"] in ["offer", "answer", "ice-candidate"]:
                target = data.get("target")
                if target and target in rooms[room_id]:
                    try:
                        await rooms[room_id][target].send_json({**data, "from": username})
                    except: pass
    except WebSocketDisconnect:
        pass
    finally:
        if room_id in rooms and username in rooms[room_id]:
            del rooms[room_id][username]
            for user, ws in list(rooms[room_id].items()):
                try:
                    await ws.send_json({"type": "user-left", "username": username})
                except: pass
            if not rooms[room_id]:
                del rooms[room_id]

# Diğer assetler için mount (en sonda)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)
