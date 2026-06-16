import Foundation

enum DayKey {
    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func make(from date: Date) -> String {
        formatter.string(from: date)
    }

    static func today() -> String {
        make(from: Date())
    }

    static func date(from key: String) -> Date? {
        formatter.date(from: key)
    }
}
