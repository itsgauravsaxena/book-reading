import CoreData
import Foundation

enum StatsRange: String, CaseIterable, Identifiable {
    case day = "Day"
    case week = "Week"
    case month = "Month"
    case year = "Year"
    var id: String { rawValue }

    var bucket: Calendar.Component {
        switch self {
        case .day:   return .hour
        case .week:  return .day
        case .month: return .day
        case .year:  return .month
        }
    }
}

struct DailyBucket: Identifiable, Hashable {
    let date: Date
    let seconds: Int
    var id: Date { date }
    var minutes: Int { seconds / 60 }
}

struct StatsAggregator {
    let context: NSManagedObjectContext
    let calendar: Calendar

    init(context: NSManagedObjectContext, calendar: Calendar = .current) {
        self.context = context
        self.calendar = calendar
    }

    func dailyTotals(from start: Date, to end: Date) -> [DailyBucket] {
        let req = NSFetchRequest<ReadingSessionEntity>(entityName: "ReadingSession")
        req.predicate = NSPredicate(format: "startedAt >= %@ AND startedAt < %@",
                                    start as NSDate, end as NSDate)
        let sessions = (try? context.fetch(req)) ?? []
        var totals: [String: Int] = [:]
        for s in sessions {
            let key = s.dayKey ?? DayKey.make(from: s.startedAt ?? .now)
            totals[key, default: 0] += Int(s.durationSeconds)
        }
        var buckets: [DailyBucket] = []
        var cursor = calendar.startOfDay(for: start)
        let endDay = calendar.startOfDay(for: end)
        while cursor < endDay {
            let key = DayKey.make(from: cursor)
            buckets.append(DailyBucket(date: cursor, seconds: totals[key] ?? 0))
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return buckets
    }

    func totalSeconds(in buckets: [DailyBucket]) -> Int {
        buckets.reduce(0) { $0 + $1.seconds }
    }

    func currentStreak(minMinutes: Int, asOf date: Date = Date()) -> Int {
        let start = calendar.startOfDay(for: date)
        var cursor = start
        var streak = 0
        let req = NSFetchRequest<NSDictionary>(entityName: "ReadingSession")
        req.resultType = .dictionaryResultType
        req.propertiesToFetch = ["dayKey"]
        req.returnsDistinctResults = true
        let groups = (try? context.fetch(req)) as? [[String: Any]] ?? []
        let activeDays = Set(groups.compactMap { $0["dayKey"] as? String })

        // Sum seconds per day, then check threshold.
        let sums = secondsByDay(in: activeDays)
        let minSeconds = minMinutes * 60

        while true {
            let key = DayKey.make(from: cursor)
            let seconds = sums[key] ?? 0
            if seconds >= minSeconds {
                streak += 1
                guard let prev = calendar.date(byAdding: .day, value: -1, to: cursor) else { break }
                cursor = prev
            } else {
                break
            }
            if streak > 3650 { break }
        }
        return streak
    }

    private func secondsByDay(in keys: Set<String>) -> [String: Int] {
        guard !keys.isEmpty else { return [:] }
        let req = NSFetchRequest<ReadingSessionEntity>(entityName: "ReadingSession")
        req.predicate = NSPredicate(format: "dayKey IN %@", keys)
        let sessions = (try? context.fetch(req)) ?? []
        var totals: [String: Int] = [:]
        for s in sessions {
            let key = s.dayKey ?? ""
            totals[key, default: 0] += Int(s.durationSeconds)
        }
        return totals
    }

    func rangeBounds(_ range: StatsRange, anchor: Date = Date()) -> (Date, Date) {
        let today = calendar.startOfDay(for: anchor)
        switch range {
        case .day:
            let end = calendar.date(byAdding: .day, value: 1, to: today)!
            return (today, end)
        case .week:
            let weekStart = calendar.date(byAdding: .day, value: -6, to: today)!
            let end = calendar.date(byAdding: .day, value: 1, to: today)!
            return (weekStart, end)
        case .month:
            let start = calendar.date(byAdding: .day, value: -29, to: today)!
            let end = calendar.date(byAdding: .day, value: 1, to: today)!
            return (start, end)
        case .year:
            let start = calendar.date(byAdding: .day, value: -364, to: today)!
            let end = calendar.date(byAdding: .day, value: 1, to: today)!
            return (start, end)
        }
    }
}
