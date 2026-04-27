import sys
import time
from typing import Iterator

import cv2
import numpy as np
from Dege import Client
from docarray import BaseDoc, DocList
from docarray.typing import NdArray


class VideoFrameDoc(BaseDoc):
    tensor: NdArray
    user: str


if len(sys.argv) == 3:
    server_address = sys.argv[1]
    user = sys.argv[2]
else:
    print("Usage: python client.py <server_address> <user>")
    sys.exit(1)

prev_frame_time = time.perf_counter()


def webcam_stream(username: str) -> Iterator[VideoFrameDoc]:
    cap = cv2.VideoCapture(0)

    if not cap.isOpened():
        raise RuntimeError("Webcam acilamadi.")

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                continue

            frame = cv2.resize(frame, (300, 200))
            yield VideoFrameDoc(tensor=frame, user=username)

            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        cap.release()
        cv2.destroyAllWindows()


def render_recv(resp):
    global prev_frame_time

    now = time.perf_counter()
    fps = 1 / max(now - prev_frame_time, 1e-6)
    prev_frame_time = now

    docs = resp.docs if hasattr(resp, "docs") else resp

    for d in docs:
        frame = d.tensor

        if frame is None:
            continue

        if not isinstance(frame, np.ndarray):
            frame = np.array(frame)

        cv2.putText(
            frame,
            f"FPS {fps:0.0f}",
            (7, 70),
            cv2.FONT_HERSHEY_SIMPLEX,
            1,
            (100, 255, 0),
            3,
            cv2.LINE_AA,
        )

        cv2.imshow("output", frame)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            raise KeyboardInterrupt


def main():
    client = Client(host=server_address)
    client.post(
        on="/",
        inputs=webcam_stream(user),
        on_done=render_recv,
        request_size=1,
        return_type=DocList[VideoFrameDoc],
    )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        cv2.destroyAllWindows()
        print("\nCikis yapildi.")
