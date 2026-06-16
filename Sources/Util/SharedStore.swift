import Foundation

/// Lightweight bridge between the app and its widget via a shared App Group.
/// Stores only the few scalars the widget needs, avoiding a shared Core Data stack.
enum SharedStore {
    static let appGroup = "group.com.ymga.bibliophil"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }

    private enum Key {
        static let todayMinutes = "todayMinutes"
        static let goalMinutes = "goalMinutes"
        static let dayKey = "dayKey"
    }

    struct Snapshot {
        var todayMinutes: Int
        var goalMinutes: Int
        var isStale: Bool
    }

    static func update(todayMinutes: Int, goalMinutes: Int) {
        guard let defaults else { return }
        defaults.set(todayMinutes, forKey: Key.todayMinutes)
        defaults.set(goalMinutes, forKey: Key.goalMinutes)
        defaults.set(DayKey.today(), forKey: Key.dayKey)
    }

    static func read() -> Snapshot {
        guard let defaults else {
            return Snapshot(todayMinutes: 0, goalMinutes: 0, isStale: true)
        }
        let storedDay = defaults.string(forKey: Key.dayKey)
        let stale = storedDay != DayKey.today()
        return Snapshot(
            todayMinutes: stale ? 0 : defaults.integer(forKey: Key.todayMinutes),
            goalMinutes: defaults.integer(forKey: Key.goalMinutes),
            isStale: stale
        )
    }
}
