import SpriteKit

// A node that tiles three star layers to create an infinite parallax starfield.
final class BackgroundNode: SKNode {

    private struct StarLayer {
        let node: SKNode
        let parallax: CGFloat   // 0 = fixed, 1 = moves with camera
        let tileHeight: CGFloat
    }

    private var layers: [StarLayer] = []
    private let screenSize: CGSize

    // Gradient sky updated per-zone
    private let skyA: SKSpriteNode
    private let skyB: SKSpriteNode

    // MARK: - Init

    init(screenSize: CGSize) {
        self.screenSize = screenSize

        skyA = SKSpriteNode(color: .black, size: CGSize(width: screenSize.width, height: screenSize.height * 3))
        skyB = SKSpriteNode(color: .black, size: CGSize(width: screenSize.width, height: screenSize.height * 3))

        super.init()
        zPosition = -10

        skyA.zPosition = -9
        skyB.zPosition = -9
        addChild(skyA)
        addChild(skyB)

        layers = [
            makeStarLayer(density: 80,  starSize: 1,  parallax: 0.05, tileH: screenSize.height * 2),
            makeStarLayer(density: 40,  starSize: 2,  parallax: 0.20, tileH: screenSize.height * 2),
            makeStarLayer(density: 15,  starSize: 3,  parallax: 0.45, tileH: screenSize.height * 2),
        ]
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    // MARK: - Update

    func update(cameraY: CGFloat, distanceFallen: CGFloat) {
        for layer in layers {
            let shifted = cameraY * layer.parallax
            // Tile the layer so stars appear infinite
            let tileH = layer.tileHeight
            var offsetY = shifted.truncatingRemainder(dividingBy: tileH)
            if offsetY > 0 { offsetY -= tileH }
            layer.node.position.y = offsetY
        }

        updateSky(cameraY: cameraY, distanceFallen: distanceFallen)
    }

    // MARK: - Sky gradient

    private func updateSky(cameraY: CGFloat, distanceFallen: CGFloat) {
        let topColor: UIColor
        let bottomColor: UIColor

        if distanceFallen < GameConfig.zoneNearSpace {
            topColor    = UIColor(red: 0.00, green: 0.00, blue: 0.05, alpha: 1)
            bottomColor = UIColor(red: 0.02, green: 0.02, blue: 0.12, alpha: 1)
        } else if distanceFallen < GameConfig.zoneUpperAtmo {
            let t = CGFloat((distanceFallen - GameConfig.zoneNearSpace) /
                            (GameConfig.zoneUpperAtmo - GameConfig.zoneNearSpace))
            topColor    = lerp(UIColor(red: 0.00, green: 0.00, blue: 0.08, alpha: 1),
                               UIColor(red: 0.00, green: 0.02, blue: 0.15, alpha: 1), t: t)
            bottomColor = lerp(UIColor(red: 0.02, green: 0.02, blue: 0.18, alpha: 1),
                               UIColor(red: 0.00, green: 0.08, blue: 0.28, alpha: 1), t: t)
        } else if distanceFallen < GameConfig.zoneLowerAtmo {
            let t = CGFloat((distanceFallen - GameConfig.zoneUpperAtmo) /
                            (GameConfig.zoneLowerAtmo - GameConfig.zoneUpperAtmo))
            topColor    = lerp(UIColor(red: 0.00, green: 0.02, blue: 0.18, alpha: 1),
                               UIColor(red: 0.00, green: 0.05, blue: 0.35, alpha: 1), t: t)
            bottomColor = lerp(UIColor(red: 0.00, green: 0.10, blue: 0.32, alpha: 1),
                               UIColor(red: 0.00, green: 0.18, blue: 0.50, alpha: 1), t: t)
        } else {
            topColor    = UIColor(red: 0.00, green: 0.05, blue: 0.35, alpha: 1)
            bottomColor = UIColor(red: 0.00, green: 0.25, blue: 0.65, alpha: 1)
        }

        // Re-render sky gradient
        let skyTex = makeSkyTexture(top: topColor, bottom: bottomColor, size: screenSize)
        skyA.texture = skyTex
        skyA.color   = .clear
        skyA.colorBlendFactor = 0
        skyA.position = CGPoint(x: 0, y: cameraY)
        skyB.isHidden = true
    }

    // MARK: - Helpers

    private func makeStarLayer(density: Int, starSize: Int, parallax: CGFloat, tileH: CGFloat) -> StarLayer {
        let container = SKNode()
        addChild(container)

        for _ in 0..<density {
            let x = CGFloat.random(in: -screenSize.width/2...screenSize.width/2)
            let y = CGFloat.random(in: 0...tileH)
            let alpha = CGFloat.random(in: 0.4...1.0)
            let dot = SKShapeNode(rectOf: CGSize(width: starSize, height: starSize))
            dot.fillColor = .white
            dot.strokeColor = .clear
            dot.alpha = alpha
            dot.position = CGPoint(x: x, y: y)
            container.addChild(dot)
        }

        return StarLayer(node: container, parallax: parallax, tileHeight: tileH)
    }

    private func makeSkyTexture(top: UIColor, bottom: UIColor, size: CGSize) -> SKTexture {
        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { ctx in
            let colors = [bottom.cgColor, top.cgColor] as CFArray
            guard let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: colors,
                locations: [0, 1]
            ) else { return }
            ctx.cgContext.drawLinearGradient(
                gradient,
                start: CGPoint(x: 0, y: size.height),
                end: .zero,
                options: []
            )
        }
        return SKTexture(image: image)
    }

    private func lerp(_ a: UIColor, _ b: UIColor, t: CGFloat) -> UIColor {
        var r1: CGFloat = 0, g1: CGFloat = 0, b1: CGFloat = 0, a1: CGFloat = 0
        var r2: CGFloat = 0, g2: CGFloat = 0, b2: CGFloat = 0, a2: CGFloat = 0
        a.getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
        b.getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
        return UIColor(red: r1 + (r2-r1)*t, green: g1+(g2-g1)*t,
                       blue: b1+(b2-b1)*t, alpha: a1+(a2-a1)*t)
    }
}
