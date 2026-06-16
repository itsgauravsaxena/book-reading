import CoreData
import Foundation

enum SampleData {
    static func populate(into ctx: NSManagedObjectContext) {
        let books: [(String, String, Int32)] = [
            ("The Pragmatic Programmer", "Andrew Hunt, David Thomas", 352),
            ("Designing Data-Intensive Applications", "Martin Kleppmann", 616),
            ("The Three-Body Problem", "Liu Cixin", 400)
        ]
        let now = Date()
        for (idx, (title, authors, pages)) in books.enumerated() {
            let b = BookEntity(context: ctx)
            b.id = UUID()
            b.title = title
            b.authorsRaw = authors
            b.pageCount = pages
            b.addedAt = Calendar.current.date(byAdding: .day, value: -idx * 3, to: now) ?? now
            b.currentPage = Int32.random(in: 10...Int32(max(20, pages - 20)))

            for d in 0..<5 {
                let s = ReadingSessionEntity(context: ctx)
                s.id = UUID()
                let start = Calendar.current.date(byAdding: .day, value: -d, to: now)!
                    .addingTimeInterval(TimeInterval(20 * 60 * idx))
                let duration = Int32.random(in: 600...2400)
                s.startedAt = start
                s.endedAt = start.addingTimeInterval(TimeInterval(duration))
                s.durationSeconds = duration
                s.pagesRead = Int32.random(in: 5...30)
                s.dayKey = DayKey.make(from: start)
                s.book = b
            }
        }

        let goal = DailyGoalEntity(context: ctx)
        goal.id = UUID()
        goal.minutesPerDay = 30
        goal.effectiveFrom = Calendar.current.date(byAdding: .day, value: -30, to: now) ?? now

        try? ctx.save()
    }
}
