// ===== Dege Video Chat — WebRTC + WebSocket =====

// --- State ---
let localStream = null;
let screenStream = null;
let ws = null;
let username = '';
let roomId = '';
const peers = {};       // {username: RTCPeerConnection}
const remoteStreams = {};// {username: MediaStream}

let micEnabled = true;
let camEnabled = true;
let screenSharing = false;
let chatOpen = true;
let unreadCount = 0;

const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
];

// --- Init ---
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    roomId = params.get('room');
    username = params.get('user');

    document.getElementById('roomIdBadge').textContent = roomId;

    if (!username) {
        // Show modal for link-join users
        document.getElementById('usernameModal').style.display = 'flex';
        const input = document.getElementById('modalUsername');
        input.focus();
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') joinWithName();
        });
    } else {
        startChat();
    }

    // Chat input enter key
    document.getElementById('chatInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
});

function joinWithName() {
    const input = document.getElementById('modalUsername');
    const name = input.value.trim();
    if (!name) {
        input.classList.add('shake');
        setTimeout(() => input.classList.remove('shake'), 500);
        return;
    }
    username = name;
    document.getElementById('usernameModal').style.display = 'none';

    // Update URL without reload
    const url = new URL(window.location);
    url.searchParams.set('user', username);
    window.history.replaceState({}, '', url);

    startChat();
}

async function startChat() {
    document.getElementById('localName').textContent = username + ' (You)';
    document.getElementById('localAvatar').textContent = username[0];

    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        showToast('HTTPS is required for camera access! 🔒');
    }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        const videoEl = document.getElementById('localVideo');
        videoEl.srcObject = localStream;
        videoEl.onloadedmetadata = () => videoEl.play().catch(e => console.error("Auto-play failed:", e));
    } catch (err) {
        console.error('Camera/microphone access error:', err);
        showToast('Camera access denied! Please allow and use HTTPS.');
        // Continue without camera
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            localStream = new MediaStream();
        }
        document.getElementById('localNoCam').style.display = 'flex';
    }

    connectWebSocket();
}

// --- WebSocket ---
const BACKEND_URL = 'https://dege-video-chat.onrender.com';
const WS_URL = 'wss://dege-video-chat.onrender.com';

function connectWebSocket() {
    ws = new WebSocket(`${WS_URL}/ws/${roomId}/${username}`);

    ws.onopen = () => {
        console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleSignal(data);
    };

    ws.onclose = () => {
        console.log('WebSocket closed');
    };

    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
    };
}

async function handleSignal(data) {
    switch (data.type) {
        case 'existing-users':
            updateParticipantCount(data.users.length + 1);
            for (const user of data.users) {
                await createOffer(user);
            }
            break;

        case 'user-joined':
            addSystemMessage(`${data.username} joined the room`);
            showToast(`${data.username} joined!`);
            break;

        case 'offer':
            await handleOffer(data);
            break;

        case 'answer':
            await handleAnswer(data);
            break;

        case 'ice-candidate':
            await handleIceCandidate(data);
            break;

        case 'chat':
            displayChatMessage(data);
            break;

        case 'user-left':
            removePeer(data.username);
            addSystemMessage(`${data.username} left the room`);
            break;

        case 'error':
            showToast(data.message);
            break;
    }
}

// --- WebRTC ---
function createPeerConnection(peerUsername) {
    if (peers[peerUsername]) return peers[peerUsername];
    
    const pc = new RTCPeerConnection({ 
        iceServers: ICE_SERVERS,
        iceCandidatePoolSize: 10
    });

    // Add local tracks BEFORE creating offer
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }

    // Handle remote stream
    pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
            remoteStreams[peerUsername] = event.streams[0];
            addRemoteVideo(peerUsername, event.streams[0]);
        }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                target: peerUsername,
                candidate: event.candidate
            }));
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            removePeer(peerUsername);
        }
    };

    peers[peerUsername] = pc;
    return pc;
}

async function createOffer(peerUsername) {
    const pc = createPeerConnection(peerUsername);
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        ws.send(JSON.stringify({
            type: 'offer',
            target: peerUsername,
            offer: { type: offer.type, sdp: offer.sdp }
        }));
    } catch (err) {
        console.error('Error creating offer:', err);
    }
}

async function handleOffer(data) {
    const pc = createPeerConnection(data.from);
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        
        // Process pending candidates
        if (pc._pendingCandidates) {
            for (const cand of pc._pendingCandidates) {
                await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e => {});
            }
            pc._pendingCandidates = [];
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        ws.send(JSON.stringify({
            type: 'answer',
            target: data.from,
            answer: { type: answer.type, sdp: answer.sdp }
        }));
    } catch (err) {
        console.error('Error handling offer:', err);
    }
}

async function handleAnswer(data) {
    const pc = peers[data.from];
    if (pc) {
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            
            if (pc._pendingCandidates) {
                for (const cand of pc._pendingCandidates) {
                    await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e => {});
                }
                pc._pendingCandidates = [];
            }
        } catch (err) {
            console.error('Error handling answer:', err);
        }
    }
}

async function handleIceCandidate(data) {
    const pc = peers[data.from];
    if (pc) {
        try {
            // Wait for remote description before adding candidates
            if (pc.remoteDescription) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } else {
                // Queue candidate if remote description not yet set
                if (!pc._pendingCandidates) pc._pendingCandidates = [];
                pc._pendingCandidates.push(data.candidate);
            }
        } catch (err) {
            console.error('ICE candidate error:', err);
        }
    }
}

// --- Video Grid ---
function addRemoteVideo(peerUsername, stream) {
    // Check if already exists
    let card = document.getElementById(`video-${peerUsername}`);
    if (card) {
        card.querySelector('video').srcObject = stream;
        return;
    }

    card = document.createElement('div');
    card.className = 'video-card';
    card.id = `video-${peerUsername}`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;

    const label = document.createElement('div');
    label.className = 'video-label';

    const name = document.createElement('span');
    name.className = 'video-name';
    name.textContent = peerUsername;
    label.appendChild(name);

    // No-cam fallback
    const noCam = document.createElement('div');
    noCam.className = 'video-no-cam';
    noCam.style.display = 'none';
    const avatar = document.createElement('div');
    avatar.className = 'avatar-circle';
    avatar.textContent = peerUsername[0].toUpperCase();
    noCam.appendChild(avatar);

    card.appendChild(video);
    card.appendChild(noCam);
    card.appendChild(label);

    document.getElementById('videoGrid').appendChild(card);
    updateGridLayout();

    // Track video state
    stream.getVideoTracks().forEach(track => {
        track.onended = () => {
            noCam.style.display = 'flex';
        };
        track.onmute = () => {
            noCam.style.display = 'flex';
        };
        track.onunmute = () => {
            noCam.style.display = 'none';
        };
    });
}

function removePeer(peerUsername) {
    if (peers[peerUsername]) {
        peers[peerUsername].close();
        delete peers[peerUsername];
    }
    delete remoteStreams[peerUsername];

    const card = document.getElementById(`video-${peerUsername}`);
    if (card) {
        card.remove();
    }

    updateGridLayout();
    updateParticipantCount(Object.keys(peers).length + 1);
}

function updateGridLayout() {
    const grid = document.getElementById('videoGrid');
    const count = grid.children.length;

    // Remove old grid classes
    grid.className = 'video-grid';

    if (count >= 5) grid.classList.add('grid-6');
    else if (count >= 3) grid.classList.add('grid-4');
    else if (count === 2) grid.classList.add('grid-2');
}

function updateParticipantCount(count) {
    document.getElementById('countText').textContent = count;
}

// --- Controls ---
function toggleMic() {
    micEnabled = !micEnabled;
    const btn = document.getElementById('micBtn');

    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = micEnabled;
        });
    }

    btn.querySelector('.icon-on').style.display = micEnabled ? 'block' : 'none';
    btn.querySelector('.icon-off').style.display = micEnabled ? 'none' : 'block';
    btn.classList.toggle('muted', !micEnabled);
}

function toggleCam() {
    camEnabled = !camEnabled;
    const btn = document.getElementById('camBtn');

    if (localStream) {
        localStream.getVideoTracks().forEach(track => {
            track.enabled = camEnabled;
        });
    }

    document.getElementById('localNoCam').style.display = camEnabled ? 'none' : 'flex';
    btn.querySelector('.icon-on').style.display = camEnabled ? 'block' : 'none';
    btn.querySelector('.icon-off').style.display = camEnabled ? 'none' : 'block';
    btn.classList.toggle('muted', !camEnabled);
}

async function toggleScreenShare() {
    const btn = document.getElementById('screenBtn');

    if (!screenSharing) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true
            });

            const screenTrack = screenStream.getVideoTracks()[0];

            // Replace video track in all peer connections
            for (const [peerUsername, pc] of Object.entries(peers)) {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    await sender.replaceTrack(screenTrack);
                }
            }

            // Show screen in local video
            document.getElementById('localVideo').srcObject = screenStream;

            screenTrack.onended = () => {
                stopScreenShare();
            };

            screenSharing = true;
            btn.classList.add('active');
            showToast('Screen sharing started');
        } catch (err) {
            console.error('Screen share error:', err);
        }
    } else {
        stopScreenShare();
    }
}

async function stopScreenShare() {
    screenSharing = false;
    const btn = document.getElementById('screenBtn');
    btn.classList.remove('active');

    if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
    }

    // Restore camera track
    if (localStream) {
        const camTrack = localStream.getVideoTracks()[0];
        if (camTrack) {
            for (const [peerUsername, pc] of Object.entries(peers)) {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    await sender.replaceTrack(camTrack);
                }
            }
        }
        document.getElementById('localVideo').srcObject = localStream;
    }
}

function toggleChat() {
    const panel = document.getElementById('chatPanel');
    const btn = document.getElementById('chatToggleBtn');
    chatOpen = !chatOpen;

    panel.classList.toggle('hidden', !chatOpen);
    btn.classList.toggle('active', chatOpen);

    if (chatOpen) {
        unreadCount = 0;
        document.getElementById('chatBadge').style.display = 'none';
        document.getElementById('chatInput').focus();
    }
}

function leaveRoom() {
    // Close all connections
    for (const [name, pc] of Object.entries(peers)) {
        pc.close();
    }

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
    }
    if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
    }
    if (ws) {
        ws.close();
    }

    window.location.href = '/';
}

// --- Chat ---
function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message || !ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
        type: 'chat',
        message: message
    }));

    input.value = '';
    input.focus();
}

function displayChatMessage(data) {
    const container = document.getElementById('chatMessages');
    const isSelf = data.username === username;

    const msg = document.createElement('div');
    msg.className = `chat-msg ${isSelf ? 'self' : ''}`;

    msg.innerHTML = `
        <div class="chat-msg-header">
            <span class="chat-msg-name ${isSelf ? 'self' : ''}">${isSelf ? 'You' : data.username}</span>
            <span class="chat-msg-time">${data.timestamp}</span>
        </div>
        <div class="chat-msg-text">${escapeHtml(data.message)}</div>
    `;

    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;

    // Unread badge
    if (!isSelf && !chatOpen) {
        unreadCount++;
        const badge = document.getElementById('chatBadge');
        badge.textContent = unreadCount;
        badge.style.display = 'flex';
    }
}

function addSystemMessage(text) {
    const container = document.getElementById('chatMessages');
    const msg = document.createElement('div');
    msg.className = 'chat-msg-system';
    msg.textContent = text;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

// --- Utilities ---
function copyRoomLink() {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    url.searchParams.delete('user'); // Don't invite them with our username
    const link = url.toString();
    navigator.clipboard.writeText(link).then(() => {
        showToast('Invite link copied! 📋');
        const btn = document.getElementById('copyLinkBtn');
        btn.style.borderColor = 'var(--success)';
        setTimeout(() => { btn.style.borderColor = ''; }, 2000);
    }).catch(() => {
        // Fallback
        const input = document.createElement('input');
        input.value = link;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('Invite link copied! 📋');
    });
}

function showToast(text) {
    const toast = document.getElementById('toast');
    toast.textContent = text;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
