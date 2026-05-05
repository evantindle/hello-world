import SpriteKit

final class GameScene: SKScene {

    // MARK: - State

    enum State { case playing, dying, dead }
    private var state: State = .playing

    // MARK: - Nodes

    private var astronaut: AstronautNode!
    private var background: BackgroundNode!
    private var hud: HUDNode!
    private let gameCamera = SKCameraNode()

    // MARK: - Systems

    private var spawner: ObstacleSpawner!

    // MARK: - Game tracking

    private var startY: CGFloat = 0
    private var score: Int = 0
    private var distanceFallen: CGFloat = 0
    private var lastUpdateTime: TimeInterval = 0
    private var totalTime: TimeInterval = 0

    // MARK: - Gravity by zone

    private var currentGravity: CGFloat = -30   // starts light in outer space

    // MARK: - Touch input

    private var isTouching = false
    private var initialTouchY: CGFloat = 0
    private var currentTouchY: CGFloat = 0

    // MARK: - Active solar winds overlapping astronaut

    private var overlappingWinds: Set<SolarWindNode> = []

    // MARK: - Lifecycle

    override func didMove(to view: SKView) {
        setupPhysics()
        setupScene()
        setupCamera()
    }

    private func setupPhysics() {
        physicsWorld.gravity = CGVector(dx: 0, dy: currentGravity)
        physicsWorld.contactDelegate = self
    }

    private func setupScene() {
        background = BackgroundNode(screenSize: size)
        addChild(background)

        astronaut = AstronautNode()
        astronaut.position = CGPoint(x: 0, y: size.height * 0.25)
        startY = astronaut.position.y
        addChild(astronaut)

        hud = HUDNode()
        hud.layout(in: size)
        gameCamera.addChild(hud)

        spawner = ObstacleSpawner(scene: self)
    }

    private func setupCamera() {
        addChild(gameCamera)
        camera = gameCamera
        gameCamera.position = astronaut.position
    }

    // MARK: - Update Loop

    override func update(_ currentTime: TimeInterval) {
        guard state == .playing else { return }

        let dt = lastUpdateTime == 0 ? 0 : min(currentTime - lastUpdateTime, 1.0 / 30.0)
        lastUpdateTime = currentTime
        totalTime += dt

        distanceFallen = max(0, startY - astronaut.position.y)

        updateGravity()
        updateAstronaut(dt: CGFloat(dt))
        applyWindForces()
        enforceBoundaries()
        updateCamera()
        spawner.update(dt: dt, playerPosition: astronaut.position,
                       distanceFallen: distanceFallen)
        score = Int(distanceFallen * GameConfig.distanceScale + totalTime * 0.4)
        hud.update(fuel: astronaut.fuel, score: score, distanceFallen: distanceFallen)
        background.update(cameraY: gameCamera.position.y, distanceFallen: distanceFallen)
    }

    // MARK: - Gravity Zones

    private func updateGravity() {
        let target: CGFloat
        if distanceFallen < GameConfig.zoneNearSpace {
            target = lerp(-30, -120, t: distanceFallen / GameConfig.zoneNearSpace)
        } else if distanceFallen < GameConfig.zoneUpperAtmo {
            let t = (distanceFallen - GameConfig.zoneNearSpace) /
                    (GameConfig.zoneUpperAtmo - GameConfig.zoneNearSpace)
            target = lerp(-120, -260, t: t)
        } else if distanceFallen < GameConfig.zoneLowerAtmo {
            let t = (distanceFallen - GameConfig.zoneUpperAtmo) /
                    (GameConfig.zoneLowerAtmo - GameConfig.zoneUpperAtmo)
            target = lerp(-260, -420, t: t)
        } else {
            target = -420
        }
        currentGravity += (target - currentGravity) * 0.03
        physicsWorld.gravity = CGVector(dx: 0, dy: currentGravity)
    }

    // MARK: - Astronaut

    private func updateAstronaut(dt: CGFloat) {
        let touchDeltaY = currentTouchY - initialTouchY
        astronaut.update(dt: dt,
                         isTouching: isTouching,
                         touchDeltaY: touchDeltaY,
                         screenHeight: size.height)
    }

    private func enforceBoundaries() {
        guard let body = astronaut.physicsBody else { return }
        let half = GameConfig.worldHalfWidth
        if astronaut.position.x < -half {
            astronaut.position.x = -half
            body.velocity.dx = max(0, body.velocity.dx)
        } else if astronaut.position.x > half {
            astronaut.position.x = half
            body.velocity.dx = min(0, body.velocity.dx)
        }
    }

    private func applyWindForces() {
        guard let body = astronaut.physicsBody else { return }
        for wind in overlappingWinds {
            body.applyForce(wind.windForce)
        }
    }

    // MARK: - Camera

    private func updateCamera() {
        // Smooth follow horizontally, tight follow vertically (player is falling)
        let target = CGPoint(x: astronaut.position.x * 0.3,
                             y: astronaut.position.y)
        let smooth: CGFloat = 0.12
        gameCamera.position.x += (target.x - gameCamera.position.x) * smooth
        gameCamera.position.y += (target.y - gameCamera.position.y) * (smooth + 0.04)
    }

    // MARK: - Death

    private func triggerDeath() {
        guard state == .playing else { return }
        state = .dying
        isTouching = false

        astronaut.die()

        // Camera shake
        let shake = SKAction.sequence([
            .moveBy(x: -12, y: 8, duration: 0.05),
            .moveBy(x: 12, y: -8, duration: 0.05),
            .moveBy(x: -8, y: 4, duration: 0.04),
            .moveBy(x: 8, y: -4, duration: 0.04),
            .moveBy(x: -4, y: 2, duration: 0.03),
            .moveBy(x: 4, y: -2, duration: 0.03),
        ])
        gameCamera.run(shake)

        // Transition to game over after delay
        run(.sequence([
            .wait(forDuration: 1.8),
            .run { [weak self] in self?.showGameOver() }
        ]))
        state = .dead
    }

    private func showGameOver() {
        let scene = GameOverScene(size: size, score: score)
        scene.scaleMode = scaleMode
        view?.presentScene(scene, transition: .fade(withDuration: 0.6))
    }

    // MARK: - Touch Handling

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard state == .playing, let touch = touches.first else { return }
        isTouching = true
        let loc = touch.location(in: self)
        initialTouchY = loc.y
        currentTouchY = loc.y
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = touches.first else { return }
        currentTouchY = touch.location(in: self).y
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        isTouching = false
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        isTouching = false
    }

    // MARK: - Helpers

    private func lerp(_ a: CGFloat, _ b: CGFloat, t: CGFloat) -> CGFloat {
        a + (b - a) * max(0, min(1, t))
    }
}

// MARK: - Physics Contact

extension GameScene: SKPhysicsContactDelegate {

    func didBegin(_ contact: SKPhysicsContact) {
        let (a, b) = sortedBodies(contact)

        if a.categoryBitMask == PhysicsCategory.astronaut &&
           b.categoryBitMask == PhysicsCategory.obstacle {
            handleObstacleContact(b)
        }

        if a.categoryBitMask == PhysicsCategory.astronaut &&
           b.categoryBitMask == PhysicsCategory.fuel {
            handleFuelContact(b)
        }
    }

    func didEnd(_ contact: SKPhysicsContact) {
        let (_, b) = sortedBodies(contact)
        if let wind = b.node as? SolarWindNode {
            overlappingWinds.remove(wind)
        }
    }

    private func sortedBodies(_ contact: SKPhysicsContact)
        -> (SKPhysicsBody, SKPhysicsBody) {
        if contact.bodyA.categoryBitMask < contact.bodyB.categoryBitMask {
            return (contact.bodyA, contact.bodyB)
        }
        return (contact.bodyB, contact.bodyA)
    }

    private func handleObstacleContact(_ body: SKPhysicsBody) {
        if let wind = body.node as? SolarWindNode {
            // Just track overlap; force applied in update loop
            overlappingWinds.insert(wind)
            return
        }
        triggerDeath()
    }

    private func handleFuelContact(_ body: SKPhysicsBody) {
        guard let canister = body.node as? FuelCanisterNode else { return }
        astronaut.fuel = min(GameConfig.maxFuel, astronaut.fuel + GameConfig.fuelPickupAmount)
        score += 50
        canister.collect()
    }
}
