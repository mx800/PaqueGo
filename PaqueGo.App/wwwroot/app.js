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

    let watchId = null;
    let orientationHandler = null;
    let absoluteOrientationHandler = null;
    let hasOrientationHeading = false;
    let hasAbsoluteOrientation = false;
    let dotNetHeadingRef = null;
    let lastHeadingPushTime = 0;

    const normalizeDegrees = (degrees) => {
        const normalized = degrees % 360;
        return normalized < 0 ? normalized + 360 : normalized;
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

        // Prefer deviceorientationabsolute (Android/Chrome) where alpha is referenced to magnetic north.
        if ("ondeviceorientationabsolute" in window) {
            absoluteOrientationHandler = (event) => {
                if (applyOrientationEvent(event)) {
                    hasAbsoluteOrientation = true;
                }
            };
            window.addEventListener("deviceorientationabsolute", absoluteOrientationHandler, true);
        }

        // Also listen to regular deviceorientation for iOS (webkitCompassHeading)
        // and as a general fallback. Priority: deviceorientationabsolute > this.
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
                state.geolocationError = error.message || "Impossible de lire la position du téléphone.";
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
            state.orientationError = state.motionPermissionGranted ? null : "Autorise la boussole pour profiter de la flèche magique.";

            if (state.motionPermissionGranted) {
                ensureOrientationListener();
            }

            return state.motionPermissionGranted;
        } catch (error) {
            state.motionPermissionGranted = false;
            state.orientationError = error?.message || "La boussole n'a pas été autorisée.";
            return false;
        }
    };

    const startSensors = () => {
        startGeolocation();
        ensureOrientationListener();
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

    return {
        getDisplayState,
        getSensorSnapshot,
        registerHeadingCallback,
        localStorageGet,
        localStorageRemove,
        localStorageSet,
        requestMotionPermission,
        startSensors,
        stopSensors,
        tryEnterFullscreen
    };
})();