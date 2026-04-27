from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import uuid
import json
import os
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = FastAPI(title="Dege Video Chat")

# Allow cross-origin requests (frontend served from thedege.com)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Room management: {room_id: {username: websocket}}
rooms: dict[str, dict[str, WebSocket]] = {}


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


@app.websocket("/ws/{room_id}/{username}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, username: str):
    await websocket.accept()

    if room_id not in rooms:
        rooms[room_id] = {}

    # Username collision check
    if username in rooms[room_id]:
        await websocket.send_json({"type": "error", "message": "This username is already taken in this room!"})
        await websocket.close()
        return

    rooms[room_id][username] = websocket

    # Notify new user of existing participants
    existing_users = [u for u in rooms[room_id] if u != username]
    await websocket.send_json({
        "type": "existing-users",
        "users": existing_users
    })

    # Notify others of new user
    for user, ws in rooms[room_id].items():
        if user != username:
            try:
                await ws.send_json({
                    "type": "user-joined",
                    "username": username
                })
            except Exception:
                pass

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)

            if data["type"] == "chat":
                timestamp = datetime.now().strftime("%H:%M")
                for user, ws in rooms[room_id].items():
                    try:
                        await ws.send_json({
                            "type": "chat",
                            "username": username,
                            "message": data["message"],
                            "timestamp": timestamp
                        })
                    except Exception:
                        pass

            elif data["type"] in ["offer", "answer", "ice-candidate"]:
                target = data.get("target")
                if target and target in rooms[room_id]:
                    try:
                        await rooms[room_id][target].send_json({
                            **data,
                            "from": username
                        })
                    except Exception:
                        pass

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if room_id in rooms and username in rooms[room_id]:
            del rooms[room_id][username]

            for user, ws in list(rooms[room_id].items()):
                try:
                    await ws.send_json({
                        "type": "user-left",
                        "username": username
                    })
                except Exception:
                    pass

            if not rooms[room_id]:
                del rooms[room_id]


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)
