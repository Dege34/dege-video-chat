import numpy as np
from Dege import Executor, requests
from docarray import BaseDoc, DocList
from docarray.typing import NdArray


class VideoFrameDoc(BaseDoc):
    tensor: NdArray
    user: str


class VideoChatExecutor(Executor):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.last_user_frames = {}

    @requests
    def foo(self, docs: DocList[VideoFrameDoc], **kwargs) -> DocList[VideoFrameDoc]:
        for d in docs:
            self.last_user_frames[d.user] = d.tensor

        frames = [frame for frame in self.last_user_frames.values() if frame is not None]

        if not frames:
            return docs

        output = np.hstack(frames) if len(frames) > 1 else frames[0]

        return DocList[VideoFrameDoc](
            [VideoFrameDoc(tensor=output, user="server")]
        )
