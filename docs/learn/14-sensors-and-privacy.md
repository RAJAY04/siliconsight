---
id: 14-sensors-and-privacy
title: Sensors, the green and orange dots, and what apps can see
minutes: 25
focus: sensors
live: [sensors.lidAngleDeg, sensors.cameraInUse, sensors.micInUse, sensors.audioPlaying, sensors.displayBrightness, sensors.keyboardBacklight, fast.lidAngleDeg, fast.fingers]
---
## In plain words

Your Mac is covered in sensors. The hinge knows exactly how far the lid is open. The trackpad feels where every finger is and how hard you press, and it never actually clicks: a tiny motor fakes the click. The camera and microphones can see and hear.

The camera and microphone are guarded. When anything uses the camera, a green light next to it turns on, and Apple designed the camera so it can't run without the light. A green or orange dot appears in the menu bar too, and closing the lid cuts the microphone off in hardware so no software, however clever, can listen.

Apps also have to ask before using the camera, microphone, screen recording or your keystrokes. You can see and change who's allowed under System Settings, Privacy & Security.

In the app: the lid in the drawing follows your real lid, fingers on the trackpad appear as dots, and the sensors panel says whether the camera or microphone is in use. The app only checks whether they're running. It never opens them.

## The idea

### The lid angle sensor

Since the 2019 16-inch MacBook Pro, Mac laptops have had a hinge angle sensor. macOS uses it for sleep and wake: Apple's repair notes warn of strange waking problems if it isn't replaced along with a hinge. There's no public API for it. In 2025 Sam Henri Gold found it shows up as a HID sensor device from Apple and worked out its report format; this app's reader uses the same device, reading a 9-bit angle in degrees whenever it changes. Developers of similar tools reported that it doesn't work on M1 MacBooks, so `lidAngleDeg` is null there and on desktop Macs.

### The trackpad

The Force Touch trackpad is a solid glass plate that barely moves. A capacitive grid under the glass tracks every finger's position and contact area. Four force sensors, one under each corner, measure how hard you press. When the pressure crosses a threshold, a linear actuator, the Taptic Engine, gives the glass a sharp sideways tap, and your finger reads it as a click. Turn the Mac off and press: nothing clicks, because there's no mechanical switch.

On M2 and later laptops, the Asahi Linux developers found the keyboard and trackpad are run by a dedicated coprocessor that talks to the main chip over a fast hardware link they call DockChannel. The app gets finger positions from macOS's private MultitouchSupport framework. It gets coordinates and sizes only, nothing about what you click or type, and they're never stored.

### The camera and microphone, and why the indicators exist

Malware that secretly records you is one of the oldest threats on any computer. Apple's answer has layers.

The camera indicator light. Apple says the Mac camera is engineered so that it can't activate without its indicator light also turning on. It hasn't always held: in 2013 researchers showed they could turn on the camera without the light on MacBook and iMac models from before 2008. On the new MacBook Neo, which has no LED, Apple instead draws the indicator on screen from a protected part of the A18 Pro chip (an exclave) that even a kernel-level attacker can't control.

The microphone disconnect. Apple's Platform Security Guide says every Apple Silicon Mac laptop disconnects the built-in microphone in hardware alone when the lid closes, so no software, even with root or kernel privileges, can listen. The camera isn't disconnected, because a closed lid already blocks it.

The menu bar dots. macOS shows a privacy indicator next to Control Center: orange for the microphone, green for a camera, purple for system audio recording, and an arrow when location is in use. Only one dot shows at a time, so camera plus microphone shows green. Open Control Center to see which apps are responsible.

Permissions. Apps must ask before using the camera, microphone, screen and system audio recording, input monitoring (seeing keystrokes and pointer events), accessibility (controlling your Mac), location, contacts, photos and more. macOS enforces these through a service called TCC (transparency, consent and control). You see a dialog the first time; your answers live under System Settings, Privacy & Security.

### What apps can read without asking

Quite a lot of the hardware state this course uses: CPU load, clocks, power, temperatures, memory, battery, disk and network byte counts, the names and memory use of your processes, and whether some app has the camera or microphone running. That's how this app works without any permission prompts. The reader's README describes checking this with `log show` while it ran: no TCC dialog, only silent preflight checks.

What they can't read without permission: what the camera sees, what the microphone hears, your screen, your keystrokes, your files in protected folders (Desktop, Documents, Downloads ask first), or the content of network traffic. This app never reads any of those.

### An analogy

A well-run office building. The camera's light is wired to the camera's power, so the lens can't open without the light coming on. The microphone has a physical switch on the door: close the door and the wire is cut. The building directory (process list), the electricity meter (power) and the thermostat (temperatures) are on public display, and anyone inside can read them. But every office with private papers has a lock, and the front desk (TCC) keeps a list of who has keys.

## Watch it live

Open the sensors panel and slowly move the lid. The drawn lid follows, from the fast channel, up to 30 updates a second while it moves. The panel also has a 2-minute lid angle sparkline. Put fingers on the trackpad: each one appears as a dot sized by contact area, and they vanish when you lift.

Below that, camera, microphone and audio output show whether any app has each one running. The "What's happening" card adds a line like "Something is using the camera" when one is on. The reader checks with CoreMediaIO and CoreAudio whether any process is running the device. It doesn't open the device itself, so it doesn't trigger the green light or the orange dot.

## Try it

### 1. The camera, three ways

Open Photo Booth:

```bash
open -a "Photo Booth"
```

Within a couple of seconds you should see the green light beside the camera, the green dot in the menu bar, and "camera in use" in the app's sensors panel. On the test Mac the reader's `cameraInUse` went from false to true. Quit Photo Booth (Command-Q, or):

```bash
osascript -e 'quit app "Photo Booth"'
```

All three go off. If a dialog asks whether Terminal may control Photo Booth, you can say no and just press Command-Q in Photo Booth instead.

### 2. Lid and fingers

Close the lid slowly from fully open to about 30 degrees and back, watching the drawing and the angle. Then rest one, two and three fingers on the trackpad and drag. Fingers are drawn from macOS's private framework; the reader's README notes the coordinate layout hasn't been checked against real touches, so if dots appear mirrored, that's the reason, and worth an issue.

### 3. See who holds permissions

Open System Settings, Privacy & Security, then Camera, Microphone, Screen & System Audio Recording, and Input Monitoring. Notice that Terminal, and this app's reader, needn't appear in any of them. Don't change anything you don't understand.

To read the current lid angle once from Terminal, from the repository root:

```bash
swift run -c release --package-path reader macviz --once 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["sample"]["sensors"])'
```

That prints the sensors object: lid angle, camera, microphone, audio, brightness and keyboard backlight.

## Check yourself

Q: Can software on an Apple Silicon MacBook record from the built-in microphone with the lid closed?
A: No. The microphone is disconnected in hardware when the lid closes.

Q: Why isn't the camera also disconnected when the lid closes?
A: The closed lid already blocks its view.

Q: Both the camera and microphone are in use. Which dot shows?
A: Green. Only one dot shows at a time, and the camera's wins.

Q: How does this app know the camera is on without triggering the light?
A: It asks CoreMediaIO whether any process is running the camera device. It never opens the camera itself.

Q: Why does a trackpad "click" feel real when the glass barely moves?
A: Force sensors detect the press and the Taptic Engine taps the glass sideways.

## Go deeper

- [Apple Platform Security, hardware microphone disconnect](https://support.apple.com/guide/security/secbbd20b00b/web): exactly what's disconnected and how.
- [Apple, Don't close your MacBook with a cover over the camera](https://support.apple.com/102177): the statement that the camera can't run without its light.
- [Apple, Control Center and privacy indicators on Mac](https://support.apple.com/guide/mac-help/mchl50f94f8f): what each dot means.
- [Michael Tsai, the secure design of the MacBook Neo's on-screen camera indicator](https://mjtsai.com/blog/?p=51291): how a screen-drawn indicator can be trusted, with the counter-arguments.
- [Sam Henri Gold, LidAngleSensor](https://github.com/samhenrigold/LidAngleSensor): the project that found the hinge sensor.
- [Our reader's README](../../reader/README.md): every sensor source, and what was checked about permissions.
