import SpriteKit

final class ObstacleSpawner {

    private weak var scene: SKScene?
    private var spawnTimer: TimeInterval = 0
    private var elapsedTime: TimeInterval = 0

    // track solar-wind contacts separately (they persist)
    private(set) var activeSolarWinds: [SolarWindNode] = []

    init(scene: SKScene) {
        self.scene = scene
    }

    // MARK: - Update

    func update(dt: TimeInterval, playerPosition: CGPoint, distanceFallen: CGFloat) {
        elapsedTime += dt
        spawnTimer -= dt

        // Update aliens toward player
        scene?.children
            .compactMap { $0 as? AlienNode }
            .forEach { $0.update(dt: CGFloat(dt), playerPosition: playerPosition) }

        // Remove nodes that scrolled past the player
        let despawnY = playerPosition.y + GameConfig.despawnTrailDistance
        scene?.children
            .compactMap { $0 as? ObstacleNode }
            .filter { $0.position.y > despawnY }
            .forEach { node in
                if let sw = node as? SolarWindNode,
                   let idx = activeSolarWinds.firstIndex(of: sw) {
                    activeSolarWinds.remove(at: idx)
                }
                node.removeFromParent()
            }

        guard spawnTimer <= 0 else { return }
        spawnObstacle(playerPosition: playerPosition, distanceFallen: distanceFallen)
        spawnTimer = currentInterval()
    }

    // MARK: - Spawning

    private func spawnObstacle(playerPosition: CGPoint, distanceFallen: CGFloat) {
        guard let scene = scene else { return }

        let node = randomObstacle(distanceFallen: distanceFallen)
        let spawnX = CGFloat.random(in: -GameConfig.worldHalfWidth...GameConfig.worldHalfWidth)
        let spawnY = playerPosition.y - GameConfig.spawnLeadDistance
        node.position = CGPoint(x: spawnX, y: spawnY)

        if let sw = node as? SolarWindNode {
            activeSolarWinds.append(sw)
        }
        scene.addChild(node)
    }

    private func randomObstacle(distanceFallen: CGFloat) -> ObstacleNode {
        // Weights change by zone
        if distanceFallen < GameConfig.zoneNearSpace {
            // Outer space: mostly large asteroids, some junk, fuel
            return pickFrom([
                (60, { AsteroidNode(large: true)  }),
                (20, { AsteroidNode(large: false) }),
                (10, { SpaceJunkNode()             }),
                (10, { FuelCanisterNode()           }),
            ])
        } else if distanceFallen < GameConfig.zoneUpperAtmo {
            // Near space: add meteors, aliens
            return pickFrom([
                (30, { AsteroidNode(large: true)  }),
                (20, { AsteroidNode(large: false) }),
                (15, { MeteorNode()                }),
                (15, { AlienNode()                 }),
                (10, { SpaceJunkNode()             }),
                (10, { FuelCanisterNode()           }),
            ])
        } else if distanceFallen < GameConfig.zoneLowerAtmo {
            // Upper atmosphere: solar winds appear
            return pickFrom([
                (25, { AsteroidNode(large: false) }),
                (20, { MeteorNode()                }),
                (20, { AlienNode()                 }),
                (15, { SpaceJunkNode()             }),
                (12, { self.makeSolarWind()        }),
                (8,  { FuelCanisterNode()           }),
            ])
        } else {
            // Lower atmosphere: everything, more frequent
            return pickFrom([
                (20, { AsteroidNode(large: false)  }),
                (20, { MeteorNode()                 }),
                (25, { AlienNode()                  }),
                (15, { SpaceJunkNode()              }),
                (12, { self.makeSolarWind()         }),
                (8,  { FuelCanisterNode()            }),
            ])
        }
    }

    private func makeSolarWind() -> SolarWindNode {
        let force = CGVector(dx: Bool.random() ? 180 : -180, dy: 0)
        return SolarWindNode(force: force)
    }

    // MARK: - Difficulty

    private func currentInterval() -> TimeInterval {
        let t = min(elapsedTime / GameConfig.difficultyRampDuration, 1.0)
        let range = GameConfig.baseSpawnInterval - GameConfig.minSpawnInterval
        return GameConfig.baseSpawnInterval - range * t
    }

    // MARK: - Helpers

    private func pickFrom<T>(_ weighted: [(Int, () -> T)]) -> T {
        let total = weighted.reduce(0) { $0 + $1.0 }
        var roll = Int.random(in: 0..<total)
        for (weight, factory) in weighted {
            if roll < weight { return factory() }
            roll -= weight
        }
        return weighted.last!.1()
    }
}
