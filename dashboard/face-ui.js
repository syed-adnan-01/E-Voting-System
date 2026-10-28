/**
 * PQ-ZKVote Admin Panel — Face Authentication & Webcam Helper
 * Handles camera streaming, frame capture, anti-spoof dual frames, and API calls.
 */

const FaceUI = (() => {
    let _activeStream = null;

    /**
     * Start webcam stream on the provided HTMLVideoElement
     * @param {HTMLVideoElement} videoEl
     * @returns {Promise<MediaStream>}
     */
    async function startWebcam(videoEl) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Webcam access is not supported by your browser");
        }

        // Stop any existing stream first
        stopWebcam(videoEl);

        try {
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
        } catch (err) {
            console.error("Camera access error:", err);
            if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
                throw new Error("Camera permission was denied. Please allow camera access in browser settings.");
            } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
                throw new Error("No camera device found on this system.");
            } else {
                throw new Error("Unable to start camera: " + err.message);
            }
        }
    }

    /**
     * Stop webcam stream on the provided HTMLVideoElement
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
     * Capture single frame from video element as base64 JPEG
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
        // Draw frame without mirroring so face recognition coordinates match standard orientation
        ctx.drawImage(videoEl, 0, 0, width, height);

        return canvas.toDataURL("image/jpeg", 0.92);
    }

    /**
     * Helper sleep function
     * @param {number} ms
     */
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Capture dual frames (~280ms apart) for anti-spoofing / eye blink liveness
     * @param {HTMLVideoElement} videoEl
     * @param {number} [intervalMs=280]
     * @returns {Promise<{ image: string, prev_image: string }>}
     */
    async function captureDualFrames(videoEl, intervalMs = 280) {
        // Frame 1: prev_image
        const prev_image = captureFrame(videoEl);
        await sleep(intervalMs);
        // Frame 2: current frame
        const image = captureFrame(videoEl);

        return { image, prev_image };
    }

    /**
     * Capture multiple frames for enrollment burst
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

    // -----------------------------------------------------------------------
    // API Call Wrappers
    // -----------------------------------------------------------------------

    /**
     * Check if admin face profile is enrolled
     * @param {string} apiBase
     */
    async function checkProfile(apiBase) {
        const res = await fetch(`${apiBase}/admin/face/profile`);
        return await res.json();
    }

    /**
     * Verify admin face against enrolled profile
     * @param {string} apiBase
     * @param {{ token: string, image: string, prev_image?: string }} params
     */
    async function verifyAdmin(apiBase, { token, image, prev_image }) {
        const res = await fetch(`${apiBase}/admin/face/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, image, prev_image })
        });
        return await res.json();
    }

    /**
     * Enroll admin face with captured images
     * @param {string} apiBase
     * @param {string} adminToken
     * @param {string[]} images
     */
    async function enrollAdmin(apiBase, adminToken, images) {
        const res = await fetch(`${apiBase}/admin/face/enroll`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Admin-Token": adminToken
            },
            body: JSON.stringify({ images })
        });
        return await res.json();
    }

    /**
     * Reset admin face profile
     * @param {string} apiBase
     * @param {string} adminToken
     */
    async function resetProfile(apiBase, adminToken) {
        const res = await fetch(`${apiBase}/admin/face/profile`, {
            method: "DELETE",
            headers: { "X-Admin-Token": adminToken }
        });
        return await res.json();
    }

    /**
     * Check if a voter has an enrolled biometric profile
     * @param {string} apiBase
     * @param {string} faceId
     */
    async function checkVoterProfile(apiBase, faceId) {
        try {
            const res = await fetch(`${apiBase}/voter-face/profile/${encodeURIComponent(faceId)}`);
            return await res.json();
        } catch (_) {
            return { enrolled: false };
        }
    }

    /**
     * Verify voter face during admin approval review
     * @param {string} apiBase
     * @param {string} adminToken
     * @param {{ faceId: string, image: string, prevImage?: string }} params
     */
    async function verifyVoter(apiBase, adminToken, { faceId, image, prevImage }) {
        const res = await fetch(`${apiBase}/admin/voter-face/verify`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Admin-Token": adminToken
            },
            body: JSON.stringify({
                face_id: faceId,
                image,
                prev_image: prevImage
            })
        });
        return await res.json();
    }

    return {
        startWebcam,
        stopWebcam,
        captureFrame,
        captureDualFrames,
        captureEnrollmentBurst,
        checkProfile,
        verifyAdmin,
        enrollAdmin,
        resetProfile,
        checkVoterProfile,
        verifyVoter
    };
})();
