import SpriteKit

// MARK: - Base class

class ObstacleNode: SKSpriteNode {

    enum Kind { case asteroidLarge, asteroidSmall, meteor, spaceJunk, alien, solarWind, fuel }

    let kind: Kind

    init(kind: Kind, texture: SKTexture) {
        self.kind = kind
        super.init(texture: texture, color: .clear, size: texture.size())
        zPosition = 5
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    func update(dt: CGFloat, playerPosition: CGPoint) {}
}

// MARK: - Asteroid

final class AsteroidNode: ObstacleNode {

    init(large: Bool) {
        let tex = large ? PixelArt.asteroidLarge : PixelArt.asteroidSmall
        super.init(kind: large ? .asteroidLarge : .asteroidSmall, texture: tex)

        let r = tex.size().width * 0.4
        physicsBody = SKPhysicsBody(circleOfRadius: r)
        physicsBody?.categoryBitMask    = PhysicsCategory.obstacle
        physicsBody?.contactTestBitMask = PhysicsCategory.astronaut
        physicsBody?.collisionBitMask   = PhysicsCategory.none
        physicsBody?.angularDamping     = 0
        physicsBody?.linearDamping      = 0
        physicsBody?.isDynamic          = false

        // Slow tumble
        physicsBody?.angularVelocity = CGFloat.random(in: -1.5...1.5)
        physicsBody?.isDynamic = true
    }
}

// MARK: - Meteor

final class MeteorNode: ObstacleNode {

    init() {
        super.init(kind: .meteor, texture: PixelArt.meteor)

        let size = PixelArt.meteor.size()
        physicsBody = SKPhysicsBody(rectangleOf: CGSize(width: size.width * 0.7,
                                                         height: size.height * 0.7))
        physicsBody?.categoryBitMask    = PhysicsCategory.obstacle
        physicsBody?.contactTestBitMask = PhysicsCategory.astronaut
        physicsBody?.collisionBitMask   = PhysicsCategory.none
        physicsBody?.linearDamping      = 0
        physicsBody?.angularDamping     = 0
        physicsBody?.isDynamic          = true

        // Meteors come in fast at an angle
        let speed = CGFloat.random(in: 380...580)
        let angle = CGFloat.random(in: -.pi * 0.4 ... .pi * 0.4)
        physicsBody?.velocity = CGVector(dx: sin(angle) * speed, dy: cos(angle) * speed)
        zRotation = angle

        addTrail()
    }

    private func addTrail() {
        let e = SKEmitterNode()
        e.particleTexture = PixelArt.spark
        e.particleBirthRate = 50
        e.particleLifetime = 0.4
        e.particleSpeed = 20
        e.particleSpeedRange = 10
        e.emissionAngle = .pi            // emit backward
        e.emissionAngleRange = .pi / 8
        e.particleColorBlendFactor = 1.0
        e.particleColorSequence = SKKeyframeSequence(
            keyframeValues: [UIColor.white, UIColor.orange, UIColor.red.withAlphaComponent(0)],
            times: [0, 0.4, 1.0]
        )
        e.particleScale = 0.4
        e.particleScaleSpeed = -0.8
        e.targetNode = parent   // emit into scene space so trail stays behind
        e.zPosition = -1
        addChild(e)
    }
}

// MARK: - Space Junk

final class SpaceJunkNode: ObstacleNode {

    init() {
        super.init(kind: .spaceJunk, texture: PixelArt.spaceJunk)

        let size = PixelArt.spaceJunk.size()
        physicsBody = SKPhysicsBody(rectangleOf: CGSize(width: size.width * 0.85,
                                                         height: size.height * 0.85))
        physicsBody?.categoryBitMask    = PhysicsCategory.obstacle
        physicsBody?.contactTestBitMask = PhysicsCategory.astronaut
        physicsBody?.collisionBitMask   = PhysicsCategory.none
        physicsBody?.linearDamping      = 0
        physicsBody?.angularDamping     = 0
        physicsBody?.isDynamic          = true

        // Slow drift
        physicsBody?.velocity = CGVector(
            dx: CGFloat.random(in: -60...60),
            dy: CGFloat.random(in: -30...30)
        )
        physicsBody?.angularVelocity = CGFloat.random(in: -1.2...1.2)
    }
}

// MARK: - Alien

final class AlienNode: ObstacleNode {

    private var chaseSpeed: CGFloat = CGFloat.random(in: 55...110)

    init() {
        super.init(kind: .alien, texture: PixelArt.alien)

        let size = PixelArt.alien.size()
        physicsBody = SKPhysicsBody(rectangleOf: CGSize(width: size.width * 0.8,
                                                         height: size.height * 0.8))
        physicsBody?.categoryBitMask    = PhysicsCategory.obstacle
        physicsBody?.contactTestBitMask = PhysicsCategory.astronaut
        physicsBody?.collisionBitMask   = PhysicsCategory.none
        physicsBody?.linearDamping      = 0.3
        physicsBody?.angularDamping     = 10
        physicsBody?.isDynamic          = true

        run(.repeatForever(.sequence([
            .scale(to: 1.05, duration: 0.4),
            .scale(to: 0.95, duration: 0.4),
        ])))
    }

    override func update(dt: CGFloat, playerPosition: CGPoint) {
        guard let body = physicsBody else { return }
        let dx = playerPosition.x - position.x
        let dy = playerPosition.y - position.y
        let dist = hypot(dx, dy)
        guard dist > 5 else { return }
        let nx = dx / dist
        let ny = dy / dist
        body.applyForce(CGVector(dx: nx * chaseSpeed * body.mass,
                                 dy: ny * chaseSpeed * body.mass))
        // Face direction of travel
        if abs(body.velocity.dx) > 10 {
            xScale = body.velocity.dx > 0 ? 1 : -1
        }
    }
}

// MARK: - Solar Wind Zone

final class SolarWindNode: ObstacleNode {

    let windForce: CGVector

    init(force: CGVector) {
        self.windForce = force
        super.init(kind: .solarWind, texture: PixelArt.solarWind)

        size = CGSize(width: 220, height: 320)
        alpha = 0.5
        zPosition = 2
        physicsBody = SKPhysicsBody(rectangleOf: size)
        physicsBody?.categoryBitMask    = PhysicsCategory.obstacle
        physicsBody?.contactTestBitMask = PhysicsCategory.astronaut
        physicsBody?.collisionBitMask   = PhysicsCategory.none
        physicsBody?.isDynamic          = false
        physicsBody?.affectedByGravity  = false

        run(.repeatForever(.sequence([
            .fadeAlpha(to: 0.25, duration: 0.8),
            .fadeAlpha(to: 0.55, duration: 0.8),
        ])))
    }

    // Force application is handled in GameScene during contact
}

// MARK: - Fuel Canister

final class FuelCanisterNode: ObstacleNode {

    init() {
        super.init(kind: .fuel, texture: PixelArt.fuelCanister)

        let size = PixelArt.fuelCanister.size()
        physicsBody = SKPhysicsBody(rectangleOf: CGSize(width: size.width * 0.8,
                                                         height: size.height * 0.8))
        physicsBody?.categoryBitMask    = PhysicsCategory.fuel
        physicsBody?.contactTestBitMask = PhysicsCategory.astronaut
        physicsBody?.collisionBitMask   = PhysicsCategory.none
        physicsBody?.isDynamic          = false
        physicsBody?.affectedByGravity  = false

        run(.repeatForever(.sequence([
            .rotate(byAngle: .pi * 2, duration: 2.0),
        ])))
    }

    func collect() {
        physicsBody = nil
        run(.sequence([
            .group([
                .scale(to: 1.6, duration: 0.15),
                .fadeOut(withDuration: 0.15),
            ]),
            .removeFromParent()
        ]))
    }
}
