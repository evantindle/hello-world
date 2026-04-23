import SpriteKit

final class MenuScene: SKScene {

    // MARK: - Lifecycle

    override func didMove(to view: SKView) {
        backgroundColor = UIColor(red: 0.02, green: 0.02, blue: 0.10, alpha: 1)
        buildStarfield()
        buildUI()
    }

    // MARK: - Starfield

    private func buildStarfield() {
        for _ in 0..<120 {
            let star = SKShapeNode(rectOf: CGSize(width: CGFloat.random(in: 1...3),
                                                  height: CGFloat.random(in: 1...3)))
            star.fillColor = .white
            star.strokeColor = .clear
            star.alpha = CGFloat.random(in: 0.2...0.9)
            star.position = CGPoint(
                x: CGFloat.random(in: -size.width/2...size.width/2),
                y: CGFloat.random(in: -size.height/2...size.height/2)
            )
            // Gentle twinkling
            let delay = CGFloat.random(in: 0...2)
            star.run(.repeatForever(.sequence([
                .wait(forDuration: TimeInterval(delay)),
                .fadeAlpha(to: CGFloat.random(in: 0.1...0.3), duration: 0.5),
                .fadeAlpha(to: CGFloat.random(in: 0.6...1.0), duration: 0.5),
            ])))
            addChild(star)
        }
    }

    // MARK: - UI

    private func buildUI() {
        // Title
        let title = SKLabelNode(fontNamed: "Courier-Bold")
        title.text = "SPACE FALL"
        title.fontSize = 40
        title.fontColor = .white
        title.position = CGPoint(x: 0, y: size.height * 0.18)
        addChild(title)

        let subtitle = SKLabelNode(fontNamed: "Courier")
        subtitle.text = "survive the descent"
        subtitle.fontSize = 16
        subtitle.fontColor = UIColor(red: 0.5, green: 0.8, blue: 1.0, alpha: 0.8)
        subtitle.position = CGPoint(x: 0, y: size.height * 0.18 - 36)
        addChild(subtitle)

        // Astronaut sprite (centered)
        let astroTex = PixelArt.astronaut
        let astroNode = SKSpriteNode(texture: astroTex)
        astroNode.position = CGPoint(x: 0, y: 0)
        astroNode.run(.repeatForever(.sequence([
            .moveBy(x: 0, y: 8, duration: 1.2),
            .moveBy(x: 0, y: -8, duration: 1.2),
        ])))
        addChild(astroNode)

        // Instructions
        let instr1 = makeLabel("HOLD screen → jetpack on", y: -size.height * 0.12, size: 13)
        let instr2 = makeLabel("SLIDE thumb up/down → rotate", y: -size.height * 0.12 - 24, size: 13)
        let instr3 = makeLabel("Tilt to steer. Collect ⚡ fuel.", y: -size.height * 0.12 - 48, size: 13)
        addChild(instr1)
        addChild(instr2)
        addChild(instr3)

        // Play button
        let button = makeButton(text: "LAUNCH", y: -size.height * 0.30)
        addChild(button)

        // Best score
        let best = UserDefaults.standard.integer(forKey: "bestScore")
        if best > 0 {
            let bestLabel = makeLabel("BEST: \(best)", y: -size.height * 0.38, size: 13)
            bestLabel.fontColor = UIColor.yellow
            addChild(bestLabel)
        }
    }

    private func makeLabel(_ text: String, y: CGFloat, size: CGFloat) -> SKLabelNode {
        let label = SKLabelNode(fontNamed: "Courier")
        label.text = text
        label.fontSize = size
        label.fontColor = UIColor(white: 0.75, alpha: 1)
        label.position = CGPoint(x: 0, y: y)
        return label
    }

    private func makeButton(text: String, y: CGFloat) -> SKNode {
        let container = SKNode()
        container.position = CGPoint(x: 0, y: y)
        container.name = "playButton"

        let bg = SKShapeNode(rectOf: CGSize(width: 160, height: 44), cornerRadius: 8)
        bg.fillColor = UIColor(red: 0.15, green: 0.55, blue: 0.90, alpha: 1)
        bg.strokeColor = UIColor(red: 0.4, green: 0.8, blue: 1.0, alpha: 1)
        bg.lineWidth = 2
        bg.name = "playButton"
        container.addChild(bg)

        let label = SKLabelNode(fontNamed: "Courier-Bold")
        label.text = text
        label.fontSize = 20
        label.fontColor = .white
        label.verticalAlignmentMode = .center
        label.name = "playButton"
        container.addChild(label)

        // Pulse the button
        container.run(.repeatForever(.sequence([
            .scale(to: 1.04, duration: 0.7),
            .scale(to: 0.97, duration: 0.7),
        ])))

        return container
    }

    // MARK: - Touch

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = touches.first else { return }
        let loc = touch.location(in: self)
        let nodes = self.nodes(at: loc)
        if nodes.contains(where: { $0.name == "playButton" }) {
            startGame()
        }
    }

    private func startGame() {
        let scene = GameScene(size: size)
        scene.scaleMode = scaleMode
        view?.presentScene(scene, transition: .doorway(withDuration: 0.6))
    }
}
