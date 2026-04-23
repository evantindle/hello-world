import UIKit
import SpriteKit

enum PixelArt {

    // MARK: - Texture factory

    static func texture(_ grid: [[UIColor]]) -> SKTexture {
        let scale = GameConfig.pixelSize
        let cols = grid[0].count
        let rows = grid.count
        let w = CGFloat(cols) * scale
        let h = CGFloat(rows) * scale

        let renderer = UIGraphicsImageRenderer(size: CGSize(width: w, height: h))
        let image = renderer.image { ctx in
            let cg = ctx.cgContext
            for row in 0..<rows {
                for col in 0..<cols {
                    let color = grid[row][col]
                    guard color.cgColor.alpha > 0 else { continue }
                    cg.setFillColor(color.cgColor)
                    // Flip Y so row-0 = visual top of sprite
                    cg.fill(CGRect(
                        x: CGFloat(col) * scale,
                        y: CGFloat(rows - 1 - row) * scale,
                        width: scale, height: scale
                    ))
                }
            }
        }
        return SKTexture(image: image)
    }

    // MARK: - Color palette

    private static let c  = UIColor.clear
    private static let W  = UIColor.white
    private static let LG = UIColor(white: 0.82, alpha: 1)
    private static let G  = UIColor(white: 0.60, alpha: 1)
    private static let DG = UIColor(white: 0.40, alpha: 1)
    private static let B  = UIColor(red: 0.08, green: 0.12, blue: 0.40, alpha: 1)
    private static let VB = UIColor(red: 0.18, green: 0.35, blue: 0.75, alpha: 1)
    private static let VH = UIColor(red: 0.50, green: 0.72, blue: 1.00, alpha: 1)
    private static let Y  = UIColor.yellow
    private static let O  = UIColor.orange
    private static let R  = UIColor.red
    private static let GN = UIColor(red: 0.20, green: 0.75, blue: 0.20, alpha: 1)
    private static let LM = UIColor(red: 0.50, green: 1.00, blue: 0.30, alpha: 1)
    private static let BR = UIColor(red: 0.52, green: 0.36, blue: 0.18, alpha: 1)
    private static let DB = UIColor(red: 0.32, green: 0.20, blue: 0.08, alpha: 1)
    private static let SL = UIColor(red: 0.75, green: 0.80, blue: 0.85, alpha: 1)
    private static let DS = UIColor(red: 0.50, green: 0.55, blue: 0.60, alpha: 1)

    // MARK: - Cached textures

    static let astronaut: SKTexture = makeAstronaut()
    static let asteroidLarge: SKTexture = makeAsteroidLarge()
    static let asteroidSmall: SKTexture = makeAsteroidSmall()
    static let meteor: SKTexture = makeMeteor()
    static let spaceJunk: SKTexture = makeSpaceJunk()
    static let alien: SKTexture = makeAlien()
    static let fuelCanister: SKTexture = makeFuelCanister()
    static let spark: SKTexture = makeSpark()
    static let solarWind: SKTexture = makeSolarWind()

    // MARK: - Sprite definitions

    private static func makeAstronaut() -> SKTexture {
        let grid: [[UIColor]] = [
            [c, c, c, W, W, W, W, W, W, c, c, c],
            [c, c, W, W, W, W, W, W, W, W, c, c],
            [c, W, W, B, B,  B,  B,  B,  B, W, W, c],
            [c, W, W, VB, VB, VB, VB, VB, VH, W, W, c],
            [c, W, W, VB, VB, VB, VB, VB, VH, W, W, c],
            [c, W, W, B, B,  B,  B,  B,  B, W, W, c],
            [c, c, W, W, W, W, W, W, W, W, c, c],
            [c, c, c, W, W, W, W, W, W, c, c, c],
            [G, G, G, W, W, W, W, W, W, G, G, G],
            [G, G, W, W, W, W, W, W, W, W, G, G],
            [DG, G, W, W, W, W, W, W, W, W, G, DG],
            [DG, G, W, W, W, W, W, W, W, W, G, DG],
            [DG, G, W, W, W, W, W, W, W, W, G, DG],
            [c, G, W, W, W, W, W, W, W, W, G, c],
            [c, c, W, W, W, c, c, W, W, W, c, c],
            [c, c, W, W, W, c, c, W, W, W, c, c],
            [c, c, W, W, W, c, c, W, W, W, c, c],
            [c, c, W, W, W, c, c, W, W, W, c, c],
            [c, c, G, G, G, c, c, G, G, G, c, c],
            [c, c, G, G, G, c, c, G, G, G, c, c],
        ]
        return texture(grid)
    }

    private static func makeAsteroidLarge() -> SKTexture {
        let grid: [[UIColor]] = [
            [c,  c,  c,  BR, BR, BR, BR, BR, BR, c,  c,  c ],
            [c,  c,  BR, BR, DB, BR, BR, DB, BR, BR, c,  c ],
            [c,  BR, BR, DB, BR, BR, BR, BR, DB, BR, BR, c ],
            [BR, BR, DB, BR, BR, DG, BR, BR, BR, DB, BR, BR],
            [BR, BR, BR, BR, DG, BR, BR, BR, BR, BR, BR, BR],
            [BR, DB, BR, BR, BR, BR, BR, BR, BR, BR, DB, BR],
            [BR, BR, BR, BR, BR, BR, DG, BR, BR, BR, BR, BR],
            [BR, BR, DB, BR, BR, BR, BR, DB, BR, BR, BR, BR],
            [c,  BR, BR, BR, BR, BR, BR, BR, BR, BR, BR, c ],
            [c,  c,  BR, BR, DB, BR, BR, BR, DB, BR, c,  c ],
            [c,  c,  c,  BR, BR, BR, BR, BR, BR, c,  c,  c ],
        ]
        return texture(grid)
    }

    private static func makeAsteroidSmall() -> SKTexture {
        let grid: [[UIColor]] = [
            [c,  BR, BR, BR, BR, c ],
            [BR, BR, DB, BR, BR, BR],
            [BR, DB, BR, BR, DB, BR],
            [BR, BR, BR, DB, BR, BR],
            [c,  BR, BR, BR, BR, c ],
            [c,  c,  BR, BR, c,  c ],
        ]
        return texture(grid)
    }

    private static func makeMeteor() -> SKTexture {
        let grid: [[UIColor]] = [
            [c,  c,  c,  O,  c,  c],
            [c,  c,  O,  R,  O,  c],
            [c,  O,  R,  R,  O,  c],
            [O,  R,  R,  DB, R,  O],
            [c,  O,  R,  R,  O,  c],
            [c,  c,  O,  R,  c,  c],
            [c,  c,  c,  O,  c,  c],
        ]
        return texture(grid)
    }

    private static func makeSpaceJunk() -> SKTexture {
        let grid: [[UIColor]] = [
            [c,  SL, SL, c,  c,  c,  SL, SL, c ],
            [SL, DS, SL, SL, SL, SL, SL, DS, SL],
            [SL, SL, SL, SL, SL, SL, SL, SL, SL],
            [c,  SL, DS, SL, SL, SL, DS, SL, c ],
            [c,  c,  SL, SL, SL, SL, SL, c,  c ],
            [c,  c,  c,  SL, DS, SL, c,  c,  c ],
        ]
        return texture(grid)
    }

    private static func makeAlien() -> SKTexture {
        let grid: [[UIColor]] = [
            [c,  c,  GN, GN, GN, GN, c,  c ],
            [c,  GN, GN, GN, GN, GN, GN, c ],
            [GN, GN, Y,  DG, Y,  DG, GN, GN],
            [GN, GN, Y,  DG, Y,  DG, GN, GN],
            [GN, LM, GN, GN, GN, GN, LM, GN],
            [c,  GN, GN, GN, GN, GN, GN, c ],
            [c,  GN, c,  GN, GN, c,  GN, c ],
            [c,  c,  c,  GN, GN, c,  c,  c ],
        ]
        return texture(grid)
    }

    private static func makeFuelCanister() -> SKTexture {
        let grid: [[UIColor]] = [
            [c,  Y,  Y,  Y,  Y,  c ],
            [Y,  O,  O,  O,  O,  Y ],
            [Y,  Y,  O,  O,  Y,  Y ],
            [Y,  O,  O,  O,  O,  Y ],
            [Y,  O,  Y,  Y,  O,  Y ],
            [Y,  O,  O,  O,  O,  Y ],
            [c,  Y,  Y,  Y,  Y,  c ],
        ]
        return texture(grid)
    }

    private static func makeSolarWind() -> SKTexture {
        let size = CGSize(width: 64, height: 64)
        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { ctx in
            let colors = [
                UIColor.cyan.withAlphaComponent(0.0).cgColor,
                UIColor.cyan.withAlphaComponent(0.15).cgColor,
                UIColor.yellow.withAlphaComponent(0.08).cgColor,
                UIColor.cyan.withAlphaComponent(0.0).cgColor,
            ]
            guard let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: colors as CFArray,
                locations: [0, 0.3, 0.7, 1.0]
            ) else { return }
            ctx.cgContext.drawLinearGradient(
                gradient,
                start: CGPoint(x: 0, y: 32),
                end: CGPoint(x: 64, y: 32),
                options: []
            )
        }
        return SKTexture(image: image)
    }

    private static func makeSpark() -> SKTexture {
        let size = CGSize(width: 8, height: 8)
        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { ctx in
            ctx.cgContext.setFillColor(UIColor.white.cgColor)
            ctx.cgContext.fillEllipse(in: CGRect(origin: .zero, size: size))
        }
        return SKTexture(image: image)
    }
}
