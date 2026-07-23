// Battery-camera power management — the piece that makes Armos usable for people
// who can't run PoE (renters, anyone on a battery or solar doorbell).
//
// Battery cameras are built to sleep and wake on their own PIR sensor, not to be
// streamed 24/7 — a continuous RTSP pull flattens the battery in a day or two.
// So in battery mode Armos keeps managed cameras DISABLED in Frigate, which stops
// Frigate's ffmpeg; the on-demand restream then releases the camera and it sleeps.
// A motion trigger — POST /trigger, the dashboard "Wake" button, or any HA/PIR/
// ONVIF automation — wakes a camera for a short window. Live detections extend the
// window, and after the activity stops the camera sleeps again.
//
// Crucially, Armos does NOT fire-and-forget the disable. Frigate boots with
// cameras enabled, and an MQTT disable does not survive a Frigate restart, so a
// naive "send OFF once" silently reverts to draining the battery. Instead the
// controller reconciles against Frigate's real `enabled/state`: whenever a managed
// camera is reported enabled outside a wake window, it is put back to sleep.
//
// This is a plain factory with no MQTT or env coupling, so it unit-tests with a
// fake publish function and the test runner's mock timers.

export type CameraState = "awake" | "waking" | "asleep";

export interface BatteryController {
  sleepAll(): void; // assert OFF for every managed camera (called on startup)
  wake(camera: string): void; // wake one managed camera and (re)arm its sleep timer
  wakeAll(): void; // wake every managed camera
  // Feed Frigate's reported enabled/state back in; re-sleeps unexpected enables.
  observeEnabled(camera: string, on: boolean): void;
  awake(): string[]; // managed cameras in a wake window (intent)
  status(): { camera: string; state: CameraState }[]; // real state, for the dashboard
}

export function createBatteryController(opts: {
  publish: (camera: string, on: boolean) => void;
  cameras: string[];
  activeSeconds: number;
}): BatteryController {
  const { publish, cameras, activeSeconds } = opts;
  const managed = new Set(cameras);
  const timers = new Map<string, ReturnType<typeof setTimeout>>(); // wake windows (intent)
  const enabled = new Map<string, boolean>(); // Frigate's last-reported real state

  const sleep = (camera: string): void => {
    const t = timers.get(camera);
    if (t) clearTimeout(t);
    timers.delete(camera);
    publish(camera, false);
  };

  const wake = (camera: string): void => {
    if (!managed.has(camera)) return;
    // Publish ON only on the leading edge; an already-open window just extends,
    // so we don't spam Frigate with redundant enable commands.
    const existing = timers.get(camera);
    if (existing) clearTimeout(existing);
    else publish(camera, true);
    timers.set(
      camera,
      setTimeout(() => {
        timers.delete(camera);
        publish(camera, false);
      }, activeSeconds * 1000),
    );
  };

  const observeEnabled = (camera: string, on: boolean): void => {
    if (!managed.has(camera)) return;
    // Enabled while we're not in a wake window = Frigate booted, restarted, or
    // someone toggled it in the UI. Force it back to sleep and don't advertise it
    // as awake — we're actively closing it.
    if (on && !timers.has(camera)) {
      publish(camera, false);
      enabled.set(camera, false);
      return;
    }
    enabled.set(camera, on);
  };

  const stateOf = (camera: string): CameraState =>
    enabled.get(camera) === true ? "awake" : timers.has(camera) ? "waking" : "asleep";

  return {
    sleepAll: () => cameras.forEach(sleep),
    wake,
    wakeAll: () => cameras.forEach(wake),
    observeEnabled,
    awake: () => cameras.filter((c) => timers.has(c)),
    status: () => cameras.map((c) => ({ camera: c, state: stateOf(c) })),
  };
}
