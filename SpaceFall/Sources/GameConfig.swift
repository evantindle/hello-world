import CoreGraphics
import Foundation

enum GameConfig {
    // Physics
    static let gravity: CGFloat = -420
    static let jetpackThrust: CGFloat = 800
    static let linearDamping: CGFloat = 0.35
    static let maxSpeed: CGFloat = 620

    // Rotation
    static let rotationSpring: CGFloat = 8.0
    static let rotationDamping: CGFloat = 5.0
    static let maxTiltAngle: CGFloat = .pi * 0.42

    // Fuel
    static let maxFuel: CGFloat = 100
    static let fuelBurnRate: CGFloat = 22
    static let fuelPickupAmount: CGFloat = 38

    // World
    static let pixelSize: CGFloat = 4
    static let worldHalfWidth: CGFloat = 200

    // Spawning
    static let spawnLeadDistance: CGFloat = 680
    static let despawnTrailDistance: CGFloat = 500
    static let baseSpawnInterval: TimeInterval = 1.7
    static let minSpawnInterval: TimeInterval = 0.50
    static let difficultyRampDuration: TimeInterval = 90

    // Scoring
    static let distanceScale: CGFloat = 0.05

    // Zone thresholds (pixels fallen)
    static let zoneNearSpace: CGFloat = 3_000
    static let zoneUpperAtmo: CGFloat = 9_000
    static let zoneLowerAtmo: CGFloat = 18_000
}

struct PhysicsCategory {
    static let none:       UInt32 = 0
    static let astronaut:  UInt32 = 1 << 0
    static let obstacle:   UInt32 = 1 << 1
    static let fuel:       UInt32 = 1 << 2
}
