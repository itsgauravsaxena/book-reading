import Foundation

enum Format {
    static func minutes(from seconds: Int32) -> String {
        let m = Int(seconds) / 60
        return "\(m) min"
    }

    static func minutes(from seconds: Int) -> String {
        "\(seconds / 60) min"
    }

    static func clock(from seconds: Int) -> String {
        let s = seconds % 60
        let m = (seconds / 60) % 60
        let h = seconds / 3600
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%d:%02d", m, s)
    }
}
