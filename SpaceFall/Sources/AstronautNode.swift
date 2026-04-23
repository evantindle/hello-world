import SpriteKit

final class AstronautNode: SKSpriteNode {

    var fuel: CGFloat = GameConfig.maxFuel
    var isJetpackActive: Bool = false { didSet { updateFlame() } }
    var isDead: Bool = false

    private let flameEmitter: SKEmitterNode = {
        let e = SKEmitterNode()
        e.particleTexture = PixelArt.spark
        e.particleBirthRate = 0
        e.particleLifetime = 0.25
        e.particleLifetimeRange = 0.08
        e.particleSpeed = 80
        e.particleSpeedRange = 30
        e.emissionAngle = -.pi / 2
        e.emissionAngleRange = .pi / 5
        e.particleColorBlendFactor = 1.0
        e.particleColorSequence = SKKeyframeSequence(
            keyframeValues: [UIColor.yellow, UIColor.orange, UIColor.red.withAlphaComponent(0)],
            times: [0, 0.5, 1.0]
        )
        e.particleScale = 0.5
        e.particleScaleRange = 0.2
        e.particleScaleSpeed = -1.0
        e.zPosition = -1
        return e
    }()

    // MARK: - Init

    init() {
        super.init(texture: PixelArt.astronaut,
                   color: .clear,
                   size: PixelArt.astronaut.size())

        name = "astronaut"
        zPosition = 10

        let spriteSize = PixelArt.astronaut.size()
        flameEmitter.position = CGPoint(x: 0, y: -spriteSize.height * 0.45)
        addChild(flameEmitter)

        setupPhysics()
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    // MARK: - Physics

    private func setupPhysics() {
        let spriteSize = PixelArt.astronaut.size()
        physicsBody = SKPhysicsBody(
            rectangleOf: CGSize(width: spriteSize.width * 0.75,
                                height: spriteSize.height * 0.90)
        )
        physicsBody?.categoryBitMask    = PhysicsCategory.astronaut
        physicsBody?.contactTestBitMask = PhysicsCategory.obstacle | PhysicsCategory.fuel
        physicsBody?.collisionBitMask   = PhysicsCategory.none
        physicsBody?.linearDamping      = GameConfig.linearDamping
        physicsBody?.angularDamping     = 0          // manual damping
        physicsBody?.allowsRotation     = true
        physicsBody?.mass               = 1.0
    }

    // MARK: - Update

    func update(dt: CGFloat, isTouching: Bool, touchDeltaY: CGFloat, screenHeight: CGFloat) {
        guard !isDead else { return }

        applyRotationControl(dt: dt, isTouching: isTouching,
                             touchDeltaY: touchDeltaY, screenHeight: screenHeight)
        applyJetpackThrust(dt: dt, active: isTouching && fuel > 0)
        clampSpeed()
    }

    private func applyRotationControl(dt: CGFloat, isTouching: Bool,
                                      touchDeltaY: CGFloat, screenHeight: CGFloat) {
        if isTouching {
            // Map touch Y delta to target rotation angle
            // Finger up (positive deltaY in SpriteKit) → tilt right → thrust right
            let targetRotation = (-touchDeltaY / (screenHeight * 0.28)) * GameConfig.maxTiltAngle
            let clamped = max(-GameConfig.maxTiltAngle, min(GameConfig.maxTiltAngle, targetRotation))
            physicsBody?.angularVelocity = (clamped - zRotation) * GameConfig.rotationSpring
        } else {
            // Damp angular velocity toward zero
            physicsBody?.angularVelocity *= max(0, 1.0 - GameConfig.rotationDamping * dt)
        }

        // Hard clamp rotation
        if abs(zRotation) > GameConfig.maxTiltAngle {
            zRotation = GameConfig.maxTiltAngle * (zRotation > 0 ? 1 : -1)
            physicsBody?.angularVelocity = 0
        }
    }

    private func applyJetpackThrust(dt: CGFloat, active: Bool) {
        isJetpackActive = active
        guard active, let body = physicsBody else { return }

        let angle = zRotation
        let thrust = GameConfig.jetpackThrust
        let fx = -sin(angle) * thrust * body.mass
        let fy =  cos(angle) * thrust * body.mass
        body.applyForce(CGVector(dx: fx, dy: fy))

        fuel -= GameConfig.fuelBurnRate * dt
        fuel = max(0, fuel)
    }

    private func clampSpeed() {
        guard let body = physicsBody else { return }
        let vel = body.velocity
        let speed = hypot(vel.dx, vel.dy)
        if speed > GameConfig.maxSpeed {
            let scale = GameConfig.maxSpeed / speed
            body.velocity = CGVector(dx: vel.dx * scale, dy: vel.dy * scale)
        }
    }

    // MARK: - Flame

    private func updateFlame() {
        flameEmitter.particleBirthRate = isJetpackActive ? 80 : 0
    }

    // MARK: - Death

    func die() {
        isDead = true
        isJetpackActive = false
        physicsBody?.categoryBitMask = PhysicsCategory.none
        physicsBody?.contactTestBitMask = PhysicsCategory.none
        // Spin out
        physicsBody?.angularVelocity = CGFloat.random(in: -8...8)
        run(.sequence([
            .wait(forDuration: 0.1),
            .colorize(with: .red, colorBlendFactor: 0.8, duration: 0.05),
            .wait(forDuration: 0.1),
            .colorize(with: .orange, colorBlendFactor: 0.8, duration: 0.05),
            .colorize(with: .clear, colorBlendFactor: 1.0, duration: 0.5),
            .removeFromParent()
        ]))
    }
}
