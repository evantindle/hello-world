# Space Fall

A 2D pixel art iOS game. An astronaut's ship blows up in orbit and he falls back toward the planet. Avoid asteroids, meteors, aliens, space junk, and solar winds while managing jetpack fuel.

## Gameplay

- **Hold** anywhere on screen → jetpack fires
- **Slide thumb up/down** from where you touched → rotates the astronaut
- The jetpack always fires through the astronaut's head — **tilt to steer**
- Collect glowing yellow **fuel canisters** to refill your jetpack
- Gravity increases as you enter the atmosphere
- Survive as long as possible and fall as far as you can

## Controls Detail

| Gesture | Effect |
|---|---|
| Touch & hold | Jetpack on |
| Slide up from touch point | Rotate counterclockwise → thrust left |
| Slide down from touch point | Rotate clockwise → thrust right |
| Release | Jetpack off, astronaut slowly stabilizes |

## Obstacles

| Obstacle | Behavior |
|---|---|
| Asteroid (large/small) | Tumbles slowly, mostly stationary |
| Meteor | Fast diagonal projectile with fire trail |
| Space junk | Drifting satellite debris |
| Alien | Slowly chases the astronaut |
| Solar wind zone | Invisible force pushing you sideways (shown as shimmer) |

## Zones

| Zone | Gravity | What appears |
|---|---|---|
| Outer Space | Very low | Large asteroids, debris, fuel |
| Near Space | Moderate | + Meteors, aliens |
| Upper Atmosphere | Strong | + Solar winds |
| Lower Atmosphere | Full | Everything, faster spawning |

## Xcode Setup

1. Open Xcode → **File → New → Project**
2. Choose **iOS → Game** template
3. Set:
   - Product Name: `SpaceFall`
   - Game Technology: **SpriteKit**
   - Language: **Swift**
4. Delete the auto-generated files:
   - `GameScene.swift` (replace with ours)
   - `GameScene.sks` (delete — we set up the scene in code)
   - `Actions.sks` (delete)
5. Drag all `.swift` files from `SpaceFall/Sources/` into the Xcode project navigator
6. In `Main.storyboard`, set the view class of the initial view controller's view to `SKView`
   - Select the `View` inside `Game View Controller`
   - In the Identity Inspector, change **Class** to `SKView`
7. Build and run on a device or simulator (iPhone portrait)

> **Tip:** For the best feel, run on a real device. The touch input for rotation is calibrated for physical screen sizes.

## Tuning

All gameplay constants are in `GameConfig.swift`:

```swift
GameConfig.jetpackThrust      // how powerful the jetpack is
GameConfig.fuelBurnRate        // fuel consumption per second
GameConfig.maxTiltAngle        // max rotation (radians)
GameConfig.rotationSpring      // how snappily rotation follows touch
GameConfig.baseSpawnInterval   // seconds between obstacle spawns (early game)
GameConfig.minSpawnInterval    // seconds at peak difficulty
```

## Project Structure

```
SpaceFall/Sources/
├── AppDelegate.swift        — App entry point
├── GameViewController.swift — SKView host
├── GameConfig.swift         — All constants & physics categories
├── PixelArt.swift           — Procedural pixel-art texture generation
├── AstronautNode.swift      — Player: physics, jetpack, rotation control
├── ObstacleNode.swift       — All obstacle & pickup types
├── ObstacleSpawner.swift    — Difficulty-ramping spawn system
├── BackgroundNode.swift     — Parallax starfield & zone sky gradients
├── HUDNode.swift            — Fuel bar, score, zone display
├── GameScene.swift          — Main game loop, physics delegate, camera
├── MenuScene.swift          — Title screen
└── GameOverScene.swift      — Score + retry/menu
```

## Notes on Pixel Art

All sprites are generated programmatically in `PixelArt.swift` using `UIGraphicsImageRenderer`. Each sprite is a 2D `[[UIColor]]` grid where each cell is one "pixel" rendered at 4×4 points. To tweak a sprite, edit its grid array in `PixelArt.swift`.

If sprites appear upside-down on your device, change the Y formula in `PixelArt.texture(_:)`:
```swift
// Current (correct for most setups):
y: CGFloat(rows - 1 - row) * scale

// If upside-down, use:
y: CGFloat(row) * scale
```
