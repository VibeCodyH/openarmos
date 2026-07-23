# OpenArmos

Self-hosted, local-first smart-home AI security. Local YOLO detection, local face recognition, and a local-LLM agent that scores threats and talks to you. No cloud, no subscription, no footage on anyone else's server.

> **Status — Alpha (v0.1.0).** The full pipeline works and is verified end to end, but so far only on a single hardware setup (one battery doorbell). Expect rough edges on other cameras and detectors. Issue reports — especially hardware-specific ones — are welcome.

## What it is

OpenArmos composes Frigate, Mosquitto, Ollama, Home Assistant, and an original `armos` agent into one local security stack. Cameras feed Frigate. Frigate publishes structured events over MQTT. The agent evaluates those events with a local model, applies house context, and can notify you or act through Home Assistant.

The default core stays light. Face recognition and remote mesh access are separate Compose profiles.

## Why

Footage, detections, face data, prompts, and model inference stay on hardware you control during normal core operation. There is no required hosted API or recurring service fee. You buy the hardware once, operate it locally, and can inspect or change every layer under the MIT license.

`NTFY_URL` can point to an external push service, and the `remote` profile uses Tailscale coordination and encrypted remote transport. Both are optional and off by default.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the component map, event flow, profiles, storage, and network boundaries.

## Quickstart

Requirements:

- Docker Engine with Compose v2
- An RTSP camera
- Enough disk for recordings and models

Configure and start the core:

```sh
cp .env.example .env
# Edit .env: set FRIGATE_RTSP_URL and, when available, HA_TOKEN.
docker compose up -d
# Equivalent:
make up
```

Pull the default local model once Ollama is running:

```sh
docker compose exec ollama ollama pull qwen3:14b
```

Open:

- armos status, chat UI, and API: `http://localhost:8099`
- armos health check: `http://localhost:8099/healthz`
- Home Assistant: `http://localhost:8123`
- Frigate: `https://localhost:8971`

The included Frigate template uses its portable CPU detector so the core can boot on varied hardware. For actual YOLO inference, add a supported local YOLO model and select the matching Frigate ONNX, OpenVINO, TensorRT, Coral, Hailo, or other detector. The exact model configuration is hardware-specific.

Add the heavier face-recognition profile:

```sh
docker compose --profile faces up -d
# Equivalent:
make up-faces
```

Then open CompreFace at `http://localhost:8000`, create a Face Recognition service, and put its API key in `config/double-take.yml.example`. Restart Double Take after the edit. Its UI is at `http://localhost:3000`.

Add secure mesh access:

```sh
# Set TS_AUTHKEY in .env first.
docker compose --profile remote up -d
# Equivalent:
make up-remote
```

The remote profile uses host networking so the host-published OpenArmos ports are available through the Tailscale node. It does not open public ingress.

## The `armos` agent

The `armos` service subscribes to `frigate/events`. It reads Frigate's event JSON, including `after.sub_label` when Double Take has attached a recognized face.

Its responsibilities are:

- score events against mode, armed zones, known faces, and house state
- produce concise natural-language notifications
- serve a dashboard: an activity feed with snapshot thumbnails and one-click links to each Frigate clip, a home/away/night switch, a notification mute toggle, a threat-level filter, and a chat box for talking to the house
- run home, away, and night behavior through `MODE`; away is the guardian posture
- trigger configured Home Assistant locks and gate entities during lockdown
- manage battery-camera power in battery mode (see below)

The service listens on port 8099 and exposes the dashboard, `/chat`, `/trigger`, and `/healthz`. Clip and snapshot links point at `FRIGATE_PUBLIC_URL` (the browser-reachable Frigate address); when Frigate authentication is on, be signed in to Frigate in the same browser for the links to load. Muting suppresses pushes but still records events to the feed. If `NTFY_URL` is blank, notifications are logged only.

## Battery cameras (renters, no PoE)

Frigate is built for always-on cameras: it holds a continuous stream to run detection. Point it at a **battery or solar camera** — a Tapo, Ring, or similar doorbell — and the nonstop pull flattens the battery in a day or two, because those cameras are designed to sleep and wake on their own PIR sensor.

Battery mode fixes that. Set `BATTERY_MODE=true` and list the cameras in `BATTERY_CAMERAS`. Armos then:

1. disables those cameras in Frigate on startup, which stops Frigate's `ffmpeg`; the on-demand restream releases the camera and it goes back to sleep,
2. wakes a camera when it's triggered — for `BATTERY_ACTIVE_SECONDS`, extended by each live detection — then sleeps it again once the activity stops.

The trigger is vendor-neutral, so any motion source can drive it:

```bash
# Wake all managed cameras (e.g. from an HA automation, an ONVIF/PIR script, or cron)
curl -X POST http://localhost:8099/trigger

# Wake one camera
curl -X POST http://localhost:8099/trigger -H 'content-type: application/json' -d '{"camera":"front_door"}'
```

The dashboard also shows an asleep/awake badge and a **Wake** button.

**Where the trigger comes from.** If your camera exposes ONVIF (most wired/PoE cameras, and Tapo/Reolink models with a "camera account" enabled), point its motion event at `/trigger` — via Home Assistant's ONVIF or Tapo integration, an ONVIF pull-point/webhook listener, or the camera's own webhook. The cleanest source for a camera that can't self-report is a cheap standalone PIR/mmWave sensor (Zigbee/Wi-Fi) at the entry that `POST`s `/trigger` the instant it sees motion.

**Battery doorbells often can't self-trigger.** Battery/solar Tapo doorbells (D210, D230, D235, …) deliberately do not expose ONVIF or RTSP, and their local API reports only motion *settings*, not live motion events — so there is no local signal to drive `/trigger` from the doorbell itself. Use the dashboard **Wake** button, or a companion motion sensor as above. (This is a TP-Link product-line limitation, confirmed against the device's own local API.)

**Trade-off:** waking a sleeping camera takes ~5–15s, so event clips start a little late and can miss the first moments at the door. That is inherent to battery cameras, not a bug. For gap-free coverage on a critical entry, a wired/PoE camera in always-on mode is still the better choice.

## Hardware notes

A CUDA-capable GPU can accelerate both Ollama and supported Frigate YOLO paths. Ollama's NVIDIA reservation is present but commented in `docker-compose.yml`; enable it after installing the NVIDIA Container Toolkit.

`qwen3:14b` is the default agent model. Its practical memory requirement depends on quantization and context size. Change `OLLAMA_MODEL` when the host cannot run it comfortably.

Frigate detection and video decoding are separate workloads. Configure its detector, model, and decode acceleration for the hardware actually present. CompreFace also requires a modern x86 CPU with AVX for its standard images.

## Roadmap

- persist the agent's event history across restarts (currently in-memory)
- ship validated Frigate YOLO presets for common NVIDIA and Intel hardware
- add authenticated Mosquitto and TLS examples
- add local push backends that do not require an external relay
- add backup and restore tooling for Home Assistant, Frigate, and face data
- add repeatable end-to-end event fixtures and health checks

## License

OpenArmos is licensed under the [MIT License](LICENSE).
