window.paqueGo = (() => {
    const state = {
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        headingDegrees: null,
        isLocationAvailable: false,
        isHeadingAvailable: false,
        requiresMotionPermission: false,
        motionPermissionGranted: false,
        geolocationError: null,
        orientationError: null
    };

    const audio = {
        context: null,
        masterGain: null,
        noiseBuffer: null,
        searchTracks: [],
        activeSearchTrackIndex: 0,
        searchTrackFadeIntervalId: null,
        searchLoopMonitorIntervalId: null,
        searchCrossfadeInProgress: false,
        victoryTrack: null,
        eggFoundNodes: [],
        eggFoundCooldownUntil: 0,
        searchGain: null,
        searchNodes: [],
        searchSparkleIntervalId: null,
        heatPulseTimeoutId: null,
        lastButtonClickTime: 0,
        isSearchActive: false,
        isFinalActive: false,
        currentHeatLevel: "Unknown"
    };

    let watchId = null;
    let orientationHandler = null;
    let absoluteOrientationHandler = null;
    let hasOrientationHeading = false;
    let hasAbsoluteOrientation = false;
    let dotNetHeadingRef = null;
    let lastHeadingPushTime = 0;
    let targetBearingDegrees = null;

    const buttonLikeSelector = "button, [role='button'], .mud-button-root, .mud-icon-button";

    const normalizeDegrees = (degrees) => {
        const normalized = degrees % 360;
        return normalized < 0 ? normalized + 360 : normalized;
    };

    const getAudioContextCtor = () => window.AudioContext || window.webkitAudioContext;

    const disconnectNode = (node) => {
        if (!node) {
            return;
        }

        try {
            node.disconnect();
        } catch {
        }
    };

    const stopNode = (node, when = 0) => {
        if (!node) {
            return;
        }

        try {
            node.stop(when);
        } catch {
        }
    };

    const ensureAudioContext = async () => {
        const AudioContextCtor = getAudioContextCtor();

        if (!AudioContextCtor) {
            return null;
        }

        if (!audio.context) {
            audio.context = new AudioContextCtor();
            audio.masterGain = audio.context.createGain();
            audio.masterGain.gain.value = 0.28;
            audio.masterGain.connect(audio.context.destination);
        }

        if (audio.context.state === "suspended") {
            try {
                await audio.context.resume();
            } catch {
            }
        }

        return audio.context;
    };

    const getNoiseBuffer = (context) => {
        if (audio.noiseBuffer) {
            return audio.noiseBuffer;
        }

        const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
        const channelData = buffer.getChannelData(0);

        for (let index = 0; index < channelData.length; index += 1) {
            channelData[index] = (Math.random() * 2 - 1) * 0.32;
        }

        audio.noiseBuffer = buffer;
        return buffer;
    };

    const releaseLayer = (gainNode, nodes, fadeDurationSeconds) => {
        const context = audio.context;

        if (!gainNode || !context) {
            nodes.forEach(disconnectNode);
            return;
        }

        const now = context.currentTime;
        const fadeTargetTime = now + fadeDurationSeconds;

        try {
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(Math.max(gainNode.gain.value, 0.0001), now);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, fadeTargetTime);
        } catch {
        }

        window.setTimeout(() => {
            nodes.forEach((node) => stopNode(node, 0));
            nodes.forEach(disconnectNode);
        }, Math.ceil((fadeDurationSeconds + 0.08) * 1000));
    };

    const stopLayerImmediately = (nodes) => {
        nodes.forEach((node) => {
            if (!node) {
                return;
            }

            stopNode(node, 0);
            disconnectNode(node);
        });
    };

    const playTone = async ({
        frequency,
        type = "sine",
        duration = 0.16,
        volume = 0.04,
        when = 0,
        attack = 0.01,
        release = 0.06,
        frequencyEnd = null,
        destination = null
    }) => {
        const context = await ensureAudioContext();

        if (!context || !audio.masterGain) {
            return null;
        }

        const output = destination ?? audio.masterGain;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const startTime = context.currentTime + when;
        const stopTime = startTime + duration + release + 0.03;

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, startTime);

        if (typeof frequencyEnd === "number" && frequencyEnd > 0 && frequencyEnd !== frequency) {
            oscillator.frequency.exponentialRampToValueAtTime(frequencyEnd, startTime + duration);
        }

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), startTime + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + release);

        oscillator.connect(gain);
        gain.connect(output);
        oscillator.start(startTime);
        oscillator.stop(stopTime);
        oscillator.onended = () => {
            disconnectNode(oscillator);
            disconnectNode(gain);
        };

        return {
            oscillator,
            gain,
            stopTime
        };
    };

    const stopEggFound = () => {
        const activeNodes = [...audio.eggFoundNodes];
        audio.eggFoundNodes = [];

        activeNodes.forEach((nodeSet) => {
            if (!nodeSet) {
                return;
            }

            stopNode(nodeSet.oscillator, 0);
            disconnectNode(nodeSet.gain);
        });

        audio.eggFoundCooldownUntil = 0;
    };

    const clearHeatPulse = () => {
        if (audio.heatPulseTimeoutId !== null) {
            window.clearTimeout(audio.heatPulseTimeoutId);
            audio.heatPulseTimeoutId = null;
        }
    };

    const clearSearchSparkles = () => {
        if (audio.searchSparkleIntervalId !== null) {
            window.clearInterval(audio.searchSparkleIntervalId);
            audio.searchSparkleIntervalId = null;
        }
    };

    const clearSearchTrackFade = () => {
        if (audio.searchTrackFadeIntervalId !== null) {
            window.clearInterval(audio.searchTrackFadeIntervalId);
            audio.searchTrackFadeIntervalId = null;
        }
    };

    const clearSearchLoopMonitor = () => {
        if (audio.searchLoopMonitorIntervalId !== null) {
            window.clearInterval(audio.searchLoopMonitorIntervalId);
            audio.searchLoopMonitorIntervalId = null;
        }
    };

    const ensureSearchTracks = () => {
        if (audio.searchTracks.length === 2) {
            return audio.searchTracks;
        }

        audio.searchTracks = [0, 1].map(() => {
            const track = new Audio("audio/search-ambience.wav");
            track.loop = false;
            track.preload = "auto";
            track.volume = 0;
            return track;
        });

        return audio.searchTracks;
    };

    const ensureVictoryTrack = () => {
        if (audio.victoryTrack) {
            return audio.victoryTrack;
        }

        const track = new Audio("audio/victory-fanfare.wav");
        track.loop = false;
        track.preload = "auto";
        track.volume = 0.5;
        audio.victoryTrack = track;
        return track;
    };

    const fadeTrackVolume = (track, targetVolume, durationMs, shouldPauseWhenDone = false, onComplete = null) => {

        if (!track) {
            return;
        }

        clearSearchTrackFade();

        const startVolume = Number.isFinite(track.volume) ? track.volume : 0;
        const stepCount = Math.max(1, Math.round(durationMs / 60));
        let stepIndex = 0;

        audio.searchTrackFadeIntervalId = window.setInterval(() => {
            stepIndex += 1;
            const progress = stepIndex / stepCount;
            track.volume = Math.max(0, Math.min(1, startVolume + (targetVolume - startVolume) * progress));

            if (stepIndex >= stepCount) {
                clearSearchTrackFade();
                track.volume = Math.max(0, Math.min(1, targetVolume));

                if (shouldPauseWhenDone) {
                    track.pause();
                }

                if (typeof onComplete === "function") {
                    onComplete();
                }
            }
        }, 60);
    };

    const stopAllSearchTracks = () => {
        clearSearchTrackFade();
        clearSearchLoopMonitor();
        audio.searchCrossfadeInProgress = false;

        audio.searchTracks.forEach((track) => {
            if (!track) {
                return;
            }

            track.pause();
            track.currentTime = 0;
            track.volume = 0;
        });
    };

    const startSearchLoopMonitor = () => {
        clearSearchLoopMonitor();

        audio.searchLoopMonitorIntervalId = window.setInterval(async () => {
            if (!audio.isSearchActive || audio.searchCrossfadeInProgress || audio.searchTracks.length !== 2) {
                return;
            }

            const currentTrack = audio.searchTracks[audio.activeSearchTrackIndex];

            if (!currentTrack || !Number.isFinite(currentTrack.duration) || currentTrack.duration <= 0) {
                return;
            }

            const crossfadeDurationSeconds = 1.6;
            const remainingSeconds = currentTrack.duration - currentTrack.currentTime;

            if (remainingSeconds > crossfadeDurationSeconds) {
                return;
            }

            audio.searchCrossfadeInProgress = true;
            const nextTrackIndex = (audio.activeSearchTrackIndex + 1) % audio.searchTracks.length;
            const nextTrack = audio.searchTracks[nextTrackIndex];

            if (!nextTrack) {
                audio.searchCrossfadeInProgress = false;
                return;
            }

            try {
                nextTrack.pause();
                nextTrack.currentTime = 0;
                nextTrack.volume = 0;
                await nextTrack.play();
            } catch {
                audio.searchCrossfadeInProgress = false;
                return;
            }

            fadeTrackVolume(nextTrack, 0.18, 1400, false);
            fadeTrackVolume(currentTrack, 0, 1400, true, () => {
                currentTrack.currentTime = 0;
                currentTrack.volume = 0;
                audio.activeSearchTrackIndex = nextTrackIndex;
                audio.searchCrossfadeInProgress = false;
            });
        }, 250);
    };

    const playMagicSparkle = (volumeScale = 1) => {
        const notes = [523.25, 587.33, 659.25, 783.99, 880];
        const firstIndex = Math.floor(Math.random() * notes.length);
        const secondIndex = (firstIndex + 2) % notes.length;

        void playTone({
            frequency: notes[firstIndex],
            type: "sine",
            duration: 0.16,
            release: 0.16,
            volume: 0.028 * volumeScale
        });
        void playTone({
            frequency: notes[secondIndex],
            type: "triangle",
            duration: 0.22,
            release: 0.2,
            volume: 0.036 * volumeScale,
            when: 0.09
        });
        void playTone({
            frequency: notes[notes.length - 1],
            type: "sine",
            duration: 0.18,
            release: 0.18,
            volume: 0.026 * volumeScale,
            when: 0.22
        });
    };

    const stopSearchAmbience = (immediate = false) => {
        clearHeatPulse();
        clearSearchSparkles();
        stopAllSearchTracks();

        if (!audio.searchGain) {
            audio.searchNodes = [];
            audio.isSearchActive = false;
            audio.currentHeatLevel = "Unknown";
            return;
        }

        const nodes = [...audio.searchNodes];

        if (immediate) {
            stopLayerImmediately(nodes);
        } else {
            releaseLayer(audio.searchGain, nodes, 0.45);
        }

        audio.searchGain = null;
        audio.searchNodes = [];
        audio.isSearchActive = false;
        audio.currentHeatLevel = "Unknown";
    };

    const startSearchAmbience = async () => {
        if (audio.isSearchActive) {
            return;
        }

        const context = await ensureAudioContext();

        if (!context || !audio.masterGain) {
            return;
        }

        const tracks = ensureSearchTracks();
        const track = tracks[audio.activeSearchTrackIndex] ?? tracks[0];

        try {
            track.pause();
            track.currentTime = 0;
            track.volume = 0;
            await track.play();
            fadeTrackVolume(track, 0.18, 900, false);
        } catch {
            return;
        }

        startSearchLoopMonitor();

        const layerGain = context.createGain();
        const shimmerLfo = context.createOscillator();
        const shimmerLfoGain = context.createGain();

        layerGain.gain.value = 0.0001;

        shimmerLfo.type = "sine";
        shimmerLfo.frequency.value = 0.18;
        shimmerLfoGain.gain.value = 0.018;

        shimmerLfo.connect(shimmerLfoGain);
        shimmerLfoGain.connect(layerGain.gain);
        layerGain.connect(audio.masterGain);

        shimmerLfo.start();

        layerGain.gain.setValueAtTime(0.0001, context.currentTime);
        layerGain.gain.exponentialRampToValueAtTime(0.024, context.currentTime + 1.15);

        playMagicSparkle(0.85);
        audio.searchSparkleIntervalId = window.setInterval(() => {
            playMagicSparkle(0.7);
        }, 5200);

        audio.searchGain = layerGain;
        audio.searchNodes = [
            shimmerLfo,
            shimmerLfoGain,
            layerGain
        ];
        audio.isSearchActive = true;
    };

    const scheduleHeatPulse = async () => {
        clearHeatPulse();

        if (!audio.isSearchActive) {
            return;
        }

        const heatProfiles = {
            Cold: { frequency: 196, type: "sine", intervalMs: 1700, volume: 0.026 },
            Warm: { frequency: 311.13, type: "triangle", intervalMs: 980, volume: 0.04 },
            Hot: { frequency: 493.88, type: "square", intervalMs: 520, volume: 0.062 }
        };

        const profile = heatProfiles[audio.currentHeatLevel];

        if (!profile) {
            return;
        }

        await playTone({
            frequency: profile.frequency,
            type: profile.type,
            duration: 0.08,
            release: 0.12,
            volume: profile.volume
        });

        audio.heatPulseTimeoutId = window.setTimeout(() => {
            void scheduleHeatPulse();
        }, profile.intervalMs);
    };

    const updateHeatZone = async (heatLevel) => {
        const nextHeatLevel = typeof heatLevel === "string" ? heatLevel : "Unknown";

        if (audio.currentHeatLevel === nextHeatLevel && (nextHeatLevel === "Unknown" || audio.heatPulseTimeoutId !== null || !audio.isSearchActive)) {
            return;
        }

        audio.currentHeatLevel = nextHeatLevel;
        clearHeatPulse();

        if (!audio.isSearchActive || nextHeatLevel === "Unknown") {
            return;
        }

        await scheduleHeatPulse();
    };

    const stopFinalAmbience = (immediate = false) => {
        if (audio.victoryTrack) {
            audio.victoryTrack.pause();
            audio.victoryTrack.currentTime = 0;
        }

        if (immediate) {
            stopLayerImmediately(audio.searchNodes);
        }

        audio.isFinalActive = false;
    };

    const startFinalAmbience = async () => {
        if (audio.isFinalActive) {
            return;
        }

        stopSearchAmbience();

        const context = await ensureAudioContext();

        if (!context || !audio.masterGain) {
            return;
        }

        const track = ensureVictoryTrack();

        try {
            track.pause();
            track.currentTime = 0;
            await track.play();
        } catch {
            return;
        }

        audio.isFinalActive = true;
    };

    const initializeAudio = async () => {
        await ensureAudioContext();
    };

    const playButtonClick = async () => {
        await playTone({
            frequency: 880,
            frequencyEnd: 659.25,
            type: "triangle",
            duration: 0.04,
            release: 0.05,
            volume: 0.034
        });
    };

    const playEggFound = async () => {
        const now = performance.now();

        if (now < audio.eggFoundCooldownUntil) {
            return;
        }

        audio.eggFoundCooldownUntil = now + 1800;
        stopEggFound();

        const activeNodes = [];
        const firstTone = await playTone({ frequency: 523.25, type: "triangle", duration: 0.14, release: 0.1, volume: 0.11 });
        const secondTone = await playTone({ frequency: 659.25, type: "triangle", duration: 0.16, release: 0.12, volume: 0.13, when: 0.12 });
        const thirdTone = await playTone({ frequency: 783.99, type: "sine", duration: 0.26, release: 0.16, volume: 0.16, when: 0.26 });
        const fourthTone = await playTone({ frequency: 1046.5, type: "sine", duration: 0.22, release: 0.18, volume: 0.13, when: 0.42 });

        [firstTone, secondTone, thirdTone, fourthTone].forEach((tone) => {
            if (tone) {
                activeNodes.push(tone);
            }
        });

        audio.eggFoundNodes = activeNodes;

        window.setTimeout(() => {
            if (audio.eggFoundNodes === activeNodes) {
                audio.eggFoundNodes = [];
            }
        }, 1600);
    };

    const updateAudioState = async (nextState = {}) => {
        const isFinalActive = !!nextState.isFinalActive;
        const isSearchActive = !!nextState.isSearchActive && !isFinalActive;
        const heatLevel = typeof nextState.heatLevel === "string" ? nextState.heatLevel : "Unknown";

        await ensureAudioContext();

        if (isFinalActive) {
            if (!audio.isFinalActive) {
                await startFinalAmbience();
            }
        } else if (audio.isFinalActive) {
            stopFinalAmbience();
        }

        if (!isFinalActive) {
            if (isSearchActive && !audio.isSearchActive) {
                await startSearchAmbience();
            } else if (!isSearchActive && audio.isSearchActive) {
                stopSearchAmbience();
            }
        }

        await updateHeatZone(isSearchActive ? heatLevel : "Unknown");
    };

    const stopAllAudio = () => {
        stopEggFound();
        stopFinalAmbience(true);
        stopSearchAmbience(true);
        clearHeatPulse();
        clearSearchSparkles();
        clearSearchTrackFade();
        clearSearchLoopMonitor();
        audio.currentHeatLevel = "Unknown";
        audio.searchCrossfadeInProgress = false;
        audio.isSearchActive = false;
        audio.isFinalActive = false;

        if (audio.victoryTrack) {
            audio.victoryTrack.pause();
            audio.victoryTrack.currentTime = 0;
        }

        if (audio.context && audio.context.state === "running") {
            audio.context.suspend().catch(() => {
            });
        }
    };

    const pushHeadingToDotNet = () => {
        if (!dotNetHeadingRef || !state.isHeadingAvailable || state.headingDegrees === null) {
            return;
        }

        const now = performance.now();

        if (now - lastHeadingPushTime < 100) {
            return;
        }

        lastHeadingPushTime = now;
        dotNetHeadingRef.invokeMethodAsync("OnHeadingChanged", state.headingDegrees);
    };

    const setHeading = (heading, source) => {
        if (typeof heading !== "number" || Number.isNaN(heading)) {
            if (source === "orientation" && hasOrientationHeading) {
                hasOrientationHeading = false;
            }

            if (!hasOrientationHeading && source === "orientation") {
                state.isHeadingAvailable = false;
            }

            return false;
        }

        if (source === "geolocation" && hasOrientationHeading) {
            return false;
        }

        state.headingDegrees = normalizeDegrees(heading);
        state.isHeadingAvailable = true;

        if (source === "orientation") {
            hasOrientationHeading = true;
            state.orientationError = null;
        }

        pushHeadingToDotNet();
        return true;
    };

    const applyOrientationEvent = (event) => {
        let heading = null;

        if (typeof event.webkitCompassHeading === "number") {
            heading = event.webkitCompassHeading;
        } else if (typeof event.alpha === "number") {
            heading = normalizeDegrees(360 - event.alpha);
        }

        return setHeading(heading, "orientation");
    };

    const ensureOrientationListener = () => {
        if (orientationHandler) {
            return;
        }

        if ("ondeviceorientationabsolute" in window) {
            absoluteOrientationHandler = (event) => {
                if (applyOrientationEvent(event)) {
                    hasAbsoluteOrientation = true;
                }
            };
            window.addEventListener("deviceorientationabsolute", absoluteOrientationHandler, true);
        }

        orientationHandler = (event) => {
            if (hasAbsoluteOrientation) {
                return;
            }

            applyOrientationEvent(event);
        };
        window.addEventListener("deviceorientation", orientationHandler, true);
    };

    const startGeolocation = () => {
        if (!navigator.geolocation || watchId !== null) {
            return;
        }

        watchId = navigator.geolocation.watchPosition(
            (position) => {
                state.latitude = position.coords.latitude;
                state.longitude = position.coords.longitude;
                state.accuracyMeters = position.coords.accuracy;
                state.isLocationAvailable = true;
                state.geolocationError = null;

                if (typeof position.coords.heading === "number" && !Number.isNaN(position.coords.heading)) {
                    setHeading(position.coords.heading, "geolocation");
                }
            },
            (error) => {
                state.isLocationAvailable = false;
                state.geolocationError = error.message || "Impossible de lire la position du telephone.";
            },
            {
                enableHighAccuracy: true,
                maximumAge: 1000,
                timeout: 15000
            });
    };

    const stopSensors = () => {
        if (watchId !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }

        hasOrientationHeading = false;
        hasAbsoluteOrientation = false;

        if (absoluteOrientationHandler) {
            window.removeEventListener("deviceorientationabsolute", absoluteOrientationHandler, true);
            absoluteOrientationHandler = null;
        }

        if (orientationHandler) {
            window.removeEventListener("deviceorientation", orientationHandler, true);
            orientationHandler = null;
        }

        dotNetHeadingRef = null;
    };

    const requestMotionPermission = async () => {
        state.requiresMotionPermission = typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function";

        if (!state.requiresMotionPermission) {
            state.motionPermissionGranted = true;
            ensureOrientationListener();
            return true;
        }

        try {
            const result = await DeviceOrientationEvent.requestPermission();
            state.motionPermissionGranted = result === "granted";
            state.orientationError = state.motionPermissionGranted ? null : "Autorise la boussole pour profiter de la fleche magique.";

            if (state.motionPermissionGranted) {
                ensureOrientationListener();
            }

            return state.motionPermissionGranted;
        } catch (error) {
            state.motionPermissionGranted = false;
            state.orientationError = error?.message || "La boussole n'a pas ete autorisee.";
            return false;
        }
    };

    const startSensors = () => {
        startGeolocation();
        ensureOrientationListener();
    };

    const setTargetBearing = (bearingDegrees) => {
        targetBearingDegrees = typeof bearingDegrees === "number" && !Number.isNaN(bearingDegrees)
            ? normalizeDegrees(bearingDegrees)
            : null;

        return targetBearingDegrees;
    };

    const registerHeadingCallback = (ref) => {
        dotNetHeadingRef = ref;
    };

    const getSensorSnapshot = () => ({ ...state });

    const getDisplayState = () => {
        const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
        return {
            isStandalone: standalone,
            canFullscreen: !!document.documentElement.requestFullscreen,
            isFullscreen: !!document.fullscreenElement
        };
    };

    const tryEnterFullscreen = async () => {
        if (!document.documentElement.requestFullscreen || document.fullscreenElement) {
            return;
        }

        try {
            await document.documentElement.requestFullscreen();
        } catch {
        }
    };

    const localStorageGet = (key) => window.localStorage.getItem(key);
    const localStorageSet = (key, value) => window.localStorage.setItem(key, value);
    const localStorageRemove = (key) => window.localStorage.removeItem(key);

    const handleDocumentClick = (event) => {
        if (!event.target || typeof event.target.closest !== "function") {
            return;
        }

        const button = event.target.closest(buttonLikeSelector);

        if (!button) {
            return;
        }

        if (!event.isTrusted || button.disabled || button.getAttribute("aria-disabled") === "true") {
            return;
        }

        const now = performance.now();

        if (now - audio.lastButtonClickTime < 140) {
            return;
        }

        audio.lastButtonClickTime = now;

        void playButtonClick();
    };

    if (window.__paqueGoButtonSoundHandler) {
        document.removeEventListener("click", window.__paqueGoButtonSoundHandler, true);
    }

    window.__paqueGoButtonSoundHandler = handleDocumentClick;
    document.addEventListener("click", handleDocumentClick, true);

    return {
        getDisplayState,
        getSensorSnapshot,
        initializeAudio,
        playButtonClick,
        playEggFound,
        registerHeadingCallback,
        localStorageGet,
        localStorageRemove,
        localStorageSet,
        requestMotionPermission,
        setTargetBearing,
        startSensors,
        stopAllAudio,
        stopSensors,
        tryEnterFullscreen,
        updateAudioState
    };
})();
