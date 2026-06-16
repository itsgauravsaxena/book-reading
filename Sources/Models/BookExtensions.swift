import CoreData
import Foundation

extension BookEntity {
    var displayAuthors: String {
        let raw = authorsRaw ?? ""
        return raw.isEmpty ? "Unknown author" : raw
    }

    var authorList: [String] {
        (authorsRaw ?? "")
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    var progressFraction: Double {
        guard pageCount > 0 else { return 0 }
        return min(1, max(0, Double(currentPage) / Double(pageCount)))
    }

    var isFinished: Bool { finishedAt != nil }
}
