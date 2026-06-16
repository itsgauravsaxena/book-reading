import CoreData
import Foundation

/// Result of a CSV import, surfaced to the user.
struct ImportSummary: Equatable {
    var booksCreated = 0
    var booksMatched = 0
    var sessionsCreated = 0
    var sessionsSkipped = 0
    var rowsSkipped = 0
    var warnings: [String] = []

    var isEmpty: Bool {
        booksCreated == 0 && sessionsCreated == 0
    }
}

enum ImportError: LocalizedError {
    case empty
    case noTitleColumn

    var errorDescription: String? {
        switch self {
        case .empty:
            return "The file has no rows."
        case .noTitleColumn:
            return "Couldn't find a Title/Book column in the header row."
        }
    }
}

/// Imports reading history from a flexible CSV. Auto-detects common column
/// names (bibliophil template, Goodreads/StoryGraph-style, generic). Creates or
/// matches books by ISBN or title+author, and adds reading sessions that carry a
/// date + duration so streaks and stats reconstruct.
enum ReadingImporter {

    // MARK: Column aliases (lowercased, punctuation/space-stripped on compare)

    private static let titleKeys = ["title", "book", "bookname", "name"]
    private static let authorKeys = ["author", "authors", "writtenby", "by"]
    private static let isbnKeys = ["isbn", "isbn13", "isbn10", "isbn/uid"]
    private static let pageCountKeys = ["pagecount", "pages", "numberofpages", "totalpages", "pagecount"]
    private static let currentPageKeys = ["currentpage", "pageat", "lastpage"]
    private static let finishedKeys = ["finished", "finishedon", "dateread", "readat", "datefinished", "lastdateread"]
    private static let dateKeys = ["date", "day", "readon", "sessiondate", "datestarted"]
    private static let minutesKeys = ["minutes", "minutesread", "duration", "time", "timeread", "readingtime"]
    private static let pagesReadKeys = ["pagesread", "pagesthissession"]

    private static func norm(_ s: String) -> String {
        s.lowercased().filter { $0.isLetter || $0.isNumber }
    }

    // MARK: Entry point

    static func importCSV(_ text: String, into ctx: NSManagedObjectContext) throws -> ImportSummary {
        let rows = CSVParser.parse(text)
        guard rows.count >= 2 else { throw ImportError.empty }

        let header = rows[0].map(norm)
        func col(_ aliases: [String]) -> Int? {
            for (idx, h) in header.enumerated() where aliases.contains(h) { return idx }
            return nil
        }

        let titleIdx = col(titleKeys)
        let authorIdx = col(authorKeys)
        let isbnIdx = col(isbnKeys)
        let pageCountIdx = col(pageCountKeys)
        let currentPageIdx = col(currentPageKeys)
        let finishedIdx = col(finishedKeys)
        let dateIdx = col(dateKeys)
        let minutesIdx = col(minutesKeys)
        let pagesReadIdx = col(pagesReadKeys)

        guard titleIdx != nil || isbnIdx != nil else { throw ImportError.noTitleColumn }

        var summary = ImportSummary()
        var bookCache: [String: BookEntity] = [:] // dedup key -> book within this run

        func field(_ row: [String], _ idx: Int?) -> String? {
            guard let idx = idx, idx < row.count else { return nil }
            let v = row[idx].trimmingCharacters(in: .whitespacesAndNewlines)
            return v.isEmpty ? nil : v
        }

        for row in rows.dropFirst() {
            let title = field(row, titleIdx)
            let isbn = field(row, isbnIdx)
            guard title != nil || isbn != nil else {
                summary.rowsSkipped += 1
                continue
            }

            // Resolve or create the book.
            let book = resolveBook(
                title: title, author: field(row, authorIdx), isbn: isbn,
                cache: &bookCache, ctx: ctx, summary: &summary
            )

            // Enrich book attributes if provided.
            if let pc = field(row, pageCountIdx).flatMap({ Int32($0.filter(\.isNumber)) }), pc > 0, book.pageCount == 0 {
                book.pageCount = pc
            }
            if let cp = field(row, currentPageIdx).flatMap({ Int32($0.filter(\.isNumber)) }), cp > book.currentPage {
                book.currentPage = cp
            }
            if book.finishedAt == nil, let f = field(row, finishedIdx), let d = parseDate(f) {
                book.finishedAt = d
            }

            // Build a session only if we have both a date and a duration.
            guard let dateStr = field(row, dateIdx), let date = parseDate(dateStr) else {
                continue
            }
            guard let minStr = field(row, minutesIdx), let seconds = parseDurationSeconds(minStr), seconds > 0 else {
                if field(row, minutesIdx) != nil {
                    summary.warnings.append("Couldn't read duration “\(field(row, minutesIdx) ?? "")” — row skipped for time.")
                }
                continue
            }

            let dayKey = DayKey.make(from: date)
            if sessionExists(book: book, dayKey: dayKey, seconds: Int32(seconds), ctx: ctx) {
                summary.sessionsSkipped += 1
                continue
            }

            let s = ReadingSessionEntity(context: ctx)
            s.id = UUID()
            s.book = book
            s.startedAt = date
            s.endedAt = date.addingTimeInterval(TimeInterval(seconds))
            s.durationSeconds = Int32(seconds)
            s.pagesRead = field(row, pagesReadIdx).flatMap { Int32($0.filter(\.isNumber)) } ?? 0
            s.dayKey = dayKey
            summary.sessionsCreated += 1
        }

        try ctx.save()
        WidgetSync.refresh(context: ctx)
        return summary
    }

    // MARK: Book resolution

    private static func resolveBook(
        title: String?, author: String?, isbn: String?,
        cache: inout [String: BookEntity], ctx: NSManagedObjectContext, summary: inout ImportSummary
    ) -> BookEntity {
        let normIsbn = isbn?.filter { $0.isNumber || $0 == "X" || $0 == "x" }
        let key = (normIsbn?.isEmpty == false ? "isbn:\(normIsbn!)" : "title:\(norm(title ?? ""))|\(norm(author ?? ""))")

        if let cached = cache[key] { return cached }

        // Look for an existing book in the store (so re-imports merge).
        let req = NSFetchRequest<BookEntity>(entityName: "Book")
        if let normIsbn, !normIsbn.isEmpty {
            req.predicate = NSPredicate(format: "isbn == %@", normIsbn)
        } else if let title {
            req.predicate = NSPredicate(format: "title ==[c] %@", title)
        }
        req.fetchLimit = 1
        if let existing = (try? ctx.fetch(req))?.first {
            cache[key] = existing
            summary.booksMatched += 1
            return existing
        }

        let b = BookEntity(context: ctx)
        b.id = UUID()
        b.title = title ?? "Untitled"
        b.authorsRaw = author
        b.isbn = (normIsbn?.isEmpty == false) ? normIsbn : nil
        b.addedAt = Date()
        b.currentPage = 0
        b.pageCount = 0
        b.source = "import"
        cache[key] = b
        summary.booksCreated += 1
        return b
    }

    private static func sessionExists(book: BookEntity, dayKey: String, seconds: Int32, ctx: NSManagedObjectContext) -> Bool {
        let req = NSFetchRequest<ReadingSessionEntity>(entityName: "ReadingSession")
        req.predicate = NSPredicate(
            format: "book == %@ AND dayKey == %@ AND durationSeconds == %d",
            book, dayKey, seconds
        )
        req.fetchLimit = 1
        return ((try? ctx.count(for: req)) ?? 0) > 0
    }

    // MARK: Parsing helpers

    /// Accepts "30", "45 min", "1:30" (h:mm), "1h 30m", "90m".
    static func parseDurationSeconds(_ raw: String) -> Int? {
        let s = raw.lowercased().trimmingCharacters(in: .whitespaces)

        // h:mm or h:mm:ss
        if s.contains(":") {
            let parts = s.split(separator: ":").map { Int($0.filter(\.isNumber)) ?? 0 }
            switch parts.count {
            case 2: return parts[0] * 3600 + parts[1] * 60
            case 3: return parts[0] * 3600 + parts[1] * 60 + parts[2]
            default: break
            }
        }
        // 1h 30m / 1h / 30m
        if s.contains("h") || s.contains("m") {
            var total = 0
            if let hRange = s.range(of: "h") {
                let h = Int(s[..<hRange.lowerBound].filter(\.isNumber)) ?? 0
                total += h * 3600
                let rest = s[hRange.upperBound...]
                let m = Int(rest.filter(\.isNumber)) ?? 0
                total += m * 60
                return total > 0 ? total : nil
            }
            if s.contains("m") {
                let m = Int(s.filter(\.isNumber)) ?? 0
                return m > 0 ? m * 60 : nil
            }
        }
        // Plain number = minutes
        if let m = Int(s.filter(\.isNumber)), m > 0 {
            return m * 60
        }
        return nil
    }

    private static let dateFormats = [
        "yyyy-MM-dd", "yyyy/MM/dd", "MM/dd/yyyy", "dd/MM/yyyy",
        "MM-dd-yyyy", "dd-MM-yyyy", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd HH:mm",
        "d MMM yyyy", "MMM d, yyyy", "MMMM d, yyyy"
    ]

    static func parseDate(_ raw: String) -> Date? {
        let s = raw.trimmingCharacters(in: .whitespaces)
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        for fmt in dateFormats {
            f.dateFormat = fmt
            if let d = f.date(from: s) { return d }
        }
        // ISO8601 fallback
        let iso = ISO8601DateFormatter()
        return iso.date(from: s)
    }

    // MARK: Template

    /// A ready-to-fill CSV the user can export, edit in any spreadsheet, and re-import.
    static func templateCSV() -> String {
        """
        Title,Author,ISBN,Pages,CurrentPage,Date,Minutes,PagesRead,Finished
        The Three-Body Problem,Liu Cixin,9780765382030,400,400,2026-01-05,45,22,2026-02-10
        The Three-Body Problem,Liu Cixin,9780765382030,400,400,2026-01-06,30,15,
        Project Hail Mary,Andy Weir,9780593135204,496,120,2026-01-07,60,28,
        """
    }
}
