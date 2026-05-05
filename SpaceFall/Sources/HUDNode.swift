import SpriteKit

final class HUDNode: SKNode {

    // Fuel bar
    private let fuelBarBG = SKShapeNode(rectOf: CGSize(width: 140, height: 14), cornerRadius: 4)
    private let fuelBarFill = SKShapeNode(rectOf: CGSize(width: 136, height: 10), cornerRadius: 3)
    private let fuelLabel = SKLabelNode(fontNamed: "Courier-Bold")

    // Score
    private let scoreLabel = SKLabelNode(fontNamed: "Courier-Bold")
    private let altitudeLabel = SKLabelNode(fontNamed: "Courier-Bold")
    private let zoneLabel = SKLabelNode(fontNamed: "Courier-Bold")

    // Low fuel warning
    private let warningLabel = SKLabelNode(fontNamed: "Courier-Bold")
    private var isWarningVisible = false

    private let barMaxWidth: CGFloat = 136

    // MARK: - Init

    override init() {
        super.init()
        zPosition = 100
        buildUI()
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    private func buildUI() {
        // Fuel background bar
        fuelBarBG.fillColor = UIColor(white: 0.1, alpha: 0.8)
        fuelBarBG.strokeColor = UIColor(white: 0.6, alpha: 0.9)
        fuelBarBG.lineWidth = 1.5
        addChild(fuelBarBG)

        // Fuel fill bar
        fuelBarFill.fillColor = .cyan
        fuelBarFill.strokeColor = .clear
        fuelBarFill.anchorPoint = CGPoint(x: 0, y: 0.5)   // left-anchored for shrink
        addChild(fuelBarFill)

        // Fuel label
        fuelLabel.fontSize = 11
        fuelLabel.fontColor = UIColor(white: 0.85, alpha: 1)
        fuelLabel.text = "FUEL"
        fuelLabel.horizontalAlignmentMode = .left
        addChild(fuelLabel)

        // Score
        scoreLabel.fontSize = 18
        scoreLabel.fontColor = .white
        scoreLabel.horizontalAlignmentMode = .right
        scoreLabel.text = "0"
        addChild(scoreLabel)

        // Altitude
        altitudeLabel.fontSize = 11
        altitudeLabel.fontColor = UIColor(white: 0.7, alpha: 1)
        altitudeLabel.horizontalAlignmentMode = .right
        altitudeLabel.text = "ALT: 0 km"
        addChild(altitudeLabel)

        // Zone label
        zoneLabel.fontSize = 11
        zoneLabel.fontColor = UIColor(red: 0.5, green: 0.8, blue: 1.0, alpha: 0.9)
        zoneLabel.horizontalAlignmentMode = .right
        altitudeLabel.text = "OUTER SPACE"
        addChild(zoneLabel)

        // Low fuel warning
        warningLabel.fontSize = 14
        warningLabel.fontColor = .red
        warningLabel.text = "⚠ LOW FUEL"
        warningLabel.alpha = 0
        addChild(warningLabel)
    }

    // MARK: - Layout (called after scene size is known)

    func layout(in size: CGSize) {
        let safeTop = size.height / 2 - 55
        let leftEdge = -size.width / 2 + 16
        let rightEdge = size.width / 2 - 16

        fuelBarBG.position    = CGPoint(x: leftEdge + 70, y: safeTop)
        fuelBarFill.position  = CGPoint(x: leftEdge + 2, y: safeTop)
        fuelLabel.position    = CGPoint(x: leftEdge + 2, y: safeTop + 10)
        fuelLabel.fontSize    = 10

        scoreLabel.position   = CGPoint(x: rightEdge, y: safeTop - 2)
        altitudeLabel.position = CGPoint(x: rightEdge, y: safeTop - 20)
        zoneLabel.position     = CGPoint(x: rightEdge, y: safeTop - 36)
        warningLabel.position  = CGPoint(x: 0, y: safeTop - 80)
    }

    // MARK: - Update

    func update(fuel: CGFloat, score: Int, distanceFallen: CGFloat) {
        let pct = max(0, min(1, fuel / GameConfig.maxFuel))

        // Fuel bar width
        let targetWidth = barMaxWidth * pct
        let action = SKAction.resize(toWidth: max(0, targetWidth), duration: 0.08)
        fuelBarFill.run(action)

        // Bar color
        let fillColor: UIColor
        if pct > 0.5 {
            fillColor = .cyan
        } else if pct > 0.25 {
            fillColor = .yellow
        } else {
            fillColor = .red
        }
        fuelBarFill.fillColor = fillColor

        // Low fuel warning
        let lowFuel = pct < 0.2
        if lowFuel != isWarningVisible {
            isWarningVisible = lowFuel
            if lowFuel {
                warningLabel.run(.repeatForever(.sequence([
                    .fadeIn(withDuration: 0.3),
                    .fadeOut(withDuration: 0.3),
                ])), withKey: "blink")
            } else {
                warningLabel.removeAction(forKey: "blink")
                warningLabel.alpha = 0
            }
        }

        // Score
        scoreLabel.text = "\(score)"

        // Altitude (convert pixels to "km" for flavor)
        let km = Int(distanceFallen / 50)
        altitudeLabel.text = String(format: "ALT ↓%d km", km)

        // Zone
        let zoneName: String
        if distanceFallen < GameConfig.zoneNearSpace {
            zoneName = "OUTER SPACE"
        } else if distanceFallen < GameConfig.zoneUpperAtmo {
            zoneName = "NEAR SPACE"
        } else if distanceFallen < GameConfig.zoneLowerAtmo {
            zoneName = "UPPER ATMO"
        } else {
            zoneName = "LOWER ATMO"
        }
        zoneLabel.text = zoneName
    }
}
