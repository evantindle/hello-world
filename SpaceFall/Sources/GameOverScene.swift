import SpriteKit

final class GameOverScene: SKScene {

    private let score: Int

    init(size: CGSize, score: Int) {
        self.score = score
        super.init(size: size)
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    // MARK: - Lifecycle

    override func didMove(to view: SKView) {
        backgroundColor = UIColor(red: 0.05, green: 0.02, blue: 0.08, alpha: 1)
        updateBestScore()
        buildUI()
        buildStarfield()
    }

    private func updateBestScore() {
        let key = "bestScore"
        let prev = UserDefaults.standard.integer(forKey: key)
        if score > prev {
            UserDefaults.standard.set(score, forKey: key)
        }
    }

    // MARK: - UI

    private func buildUI() {
        // Game over header
        let header = SKLabelNode(fontNamed: "Courier-Bold")
        header.text = "MISSION FAILED"
        header.fontSize = 30
        header.fontColor = UIColor(red: 1.0, green: 0.3, blue: 0.2, alpha: 1)
        header.position = CGPoint(x: 0, y: size.height * 0.20)
        header.setScale(0)
        header.run(.sequence([
            .wait(forDuration: 0.2),
            .scale(to: 1.05, duration: 0.25),
            .scale(to: 1.0, duration: 0.1),
        ]))
        addChild(header)

        let sub = SKLabelNode(fontNamed: "Courier")
        sub.text = "the astronaut didn't make it"
        sub.fontSize = 13
        sub.fontColor = UIColor(white: 0.6, alpha: 1)
        sub.position = CGPoint(x: 0, y: size.height * 0.20 - 34)
        addChild(sub)

        // Score display
        let scoreTitle = makeLabel("SCORE", y: size.height * 0.02, size: 14,
                                   color: UIColor(white: 0.65, alpha: 1))
        let scoreValue = makeLabel("\(score)", y: size.height * 0.02 - 32, size: 42,
                                   color: .white)
        scoreValue.fontName = "Courier-Bold"
        addChild(scoreTitle)
        addChild(scoreValue)

        // Best score
        let best = UserDefaults.standard.integer(forKey: "bestScore")
        let bestColor: UIColor = score >= best ? .yellow : UIColor(white: 0.65, alpha: 1)
        let bestLabel = makeLabel(score >= best ? "★ NEW BEST!" : "BEST: \(best)",
                                  y: size.height * 0.02 - 72, size: 16, color: bestColor)
        addChild(bestLabel)

        // Retry button
        let retry = makeButton(text: "TRY AGAIN", y: -size.height * 0.18, name: "retry")
        addChild(retry)

        // Menu button
        let menu = makeButton(text: "MENU", y: -size.height * 0.30, name: "menu")
        (menu.children.first as? SKShapeNode)?.fillColor =
            UIColor(red: 0.25, green: 0.25, blue: 0.35, alpha: 1)
        addChild(menu)
    }

    private func makeLabel(_ text: String, y: CGFloat, size: CGFloat,
                            color: UIColor) -> SKLabelNode {
        let label = SKLabelNode(fontNamed: "Courier")
        label.text = text
        label.fontSize = size
        label.fontColor = color
        label.position = CGPoint(x: 0, y: y)
        label.verticalAlignmentMode = .center
        return label
    }

    private func makeButton(text: String, y: CGFloat, name: String) -> SKNode {
        let container = SKNode()
        container.position = CGPoint(x: 0, y: y)
        container.name = name

        let bg = SKShapeNode(rectOf: CGSize(width: 180, height: 46), cornerRadius: 8)
        bg.fillColor = UIColor(red: 0.15, green: 0.55, blue: 0.90, alpha: 1)
        bg.strokeColor = UIColor(red: 0.4, green: 0.8, blue: 1.0, alpha: 1)
        bg.lineWidth = 2
        bg.name = name
        container.addChild(bg)

        let label = SKLabelNode(fontNamed: "Courier-Bold")
        label.text = text
        label.fontSize = 20
        label.fontColor = .white
        label.verticalAlignmentMode = .center
        label.name = name
        container.addChild(label)

        return container
    }

    private func buildStarfield() {
        for _ in 0..<80 {
            let star = SKShapeNode(rectOf: CGSize(width: 1.5, height: 1.5))
            star.fillColor = .white
            star.strokeColor = .clear
            star.alpha = CGFloat.random(in: 0.1...0.6)
            star.position = CGPoint(
                x: CGFloat.random(in: -size.width/2...size.width/2),
                y: CGFloat.random(in: -size.height/2...size.height/2)
            )
            addChild(star)
        }
    }

    // MARK: - Touch

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = touches.first else { return }
        let loc = touch.location(in: self)
        let nodes = self.nodes(at: loc)

        if nodes.contains(where: { $0.name == "retry" }) {
            let scene = GameScene(size: size)
            scene.scaleMode = scaleMode
            view?.presentScene(scene, transition: .fade(withDuration: 0.4))
        } else if nodes.contains(where: { $0.name == "menu" }) {
            let scene = MenuScene(size: size)
            scene.scaleMode = scaleMode
            view?.presentScene(scene, transition: .fade(withDuration: 0.5))
        }
    }
}
