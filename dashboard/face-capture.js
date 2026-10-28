/**
 * PQ-ZKVote Voter Station — Client-Side Face Capture Helper (face-capture.js)
 * Enables optional ephemeral face enrollment during registration.
 * Computes deterministic short face_id = sha256(commitment).substring(0, 16).
 */

const VoterFaceCapture = (() => {
    let _activeStream = null;

    /**
     * Deterministically derive 16-char ephemeral face ID from Poseidon commitment
     * @param {string} commitment
     * @returns {Promise<string>}
     */
    async function deriveFaceId(commitment) {
        if (!commitment) return "";
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(String(commitment));
            const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
            return hashHex.substring(0, 16);
        } catch (_) {
            // Fallback for non-subtle crypto environments
            let hash = 0;
            const str = String(commitment);
            for (let i = 0; i < str.length; i++) {
                hash = ((hash << 5) - hash) + str.charCodeAt(i);
                hash |= 0;
            }
            return Math.abs(hash).toString(16).padStart(16, "0").substring(0, 16);
        }
    }

    /**
     * Start webcam stream on the given HTMLVideoElement
     * @param {HTMLVideoElement} videoEl
     * @returns {Promise<MediaStream>}
     */
    async function startWebcam(videoEl) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Webcam is not supported on this browser device");
        }

        stopWebcam(videoEl);

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: "user"
            },
            audio: false
        });

        _activeStream = stream;
        videoEl.srcObject = stream;
        videoEl.setAttribute("playsinline", "true");
        videoEl.muted = true;
        await videoEl.play();
        return stream;
    }

    /**
     * Stop active webcam stream
     * @param {HTMLVideoElement} [videoEl]
     */
    function stopWebcam(videoEl) {
        if (_activeStream) {
            _activeStream.getTracks().forEach(track => track.stop());
            _activeStream = null;
        }
        if (videoEl && videoEl.srcObject) {
            try {
                videoEl.srcObject.getTracks().forEach(track => track.stop());
            } catch (_) {}
            videoEl.srcObject = null;
        }
    }

    /**
     * Capture single frame as base64 JPEG data URL
     * @param {HTMLVideoElement} videoEl
     * @returns {string} base64 data URL
     */
    function captureFrame(videoEl) {
        const width = videoEl.videoWidth || 640;
        const height = videoEl.videoHeight || 480;

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(videoEl, 0, 0, width, height);

        return canvas.toDataURL("image/jpeg", 0.92);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Capture multiple burst frames for face-service FaceNet enrollment
     * @param {HTMLVideoElement} videoEl
     * @param {number} [count=5]
     * @param {number} [intervalMs=700]
     * @param {function} [onProgress]
     * @returns {Promise<string[]>}
     */
    async function captureEnrollmentBurst(videoEl, count = 5, intervalMs = 700, onProgress = null) {
        const images = [];

        for (let i = 0; i < count; i++) {
            if (onProgress) {
                onProgress(i + 1, count);
            }
            images.push(captureFrame(videoEl));
            if (i < count - 1) {
                await sleep(intervalMs);
            }
        }

        return images;
    }

    /**
     * Submit captured face images to registrar for enrollment
     * @param {string} registrarUrl
     * @param {string} faceId
     * @param {string[]} images
     */
    async function enrollVoterFace(registrarUrl, faceId, images) {
        const res = await fetch(`${registrarUrl}/voter-face/enroll`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ face_id: faceId, images })
        });
        return await res.json();
    }

    return {
        deriveFaceId,
        startWebcam,
        stopWebcam,
        captureFrame,
        captureEnrollmentBurst,
        enrollVoterFace
    };
})();
