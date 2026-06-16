import Foundation

enum BookSource: String, Codable {
    case googleBooks = "google_books"
    case openLibrary = "open_library"
    case manual
}

struct BookSearchResult: Identifiable, Hashable {
    var id: String { "\(source.rawValue):\(externalId)" }
    let title: String
    let authors: [String]
    let isbn: String?
    let coverURL: URL?
    let pageCount: Int?
    let publishedYear: Int?
    let source: BookSource
    let externalId: String
}

enum BookSearchQuery: Equatable {
    case isbn(String)
    case title(String)
    case author(String)
    case freeform(String)

    var debugDescription: String {
        switch self {
        case .isbn(let v): return "isbn:\(v)"
        case .title(let v): return "title:\(v)"
        case .author(let v): return "author:\(v)"
        case .freeform(let v): return "freeform:\(v)"
        }
    }
}

protocol BookSearchService {
    func search(_ query: BookSearchQuery) async throws -> [BookSearchResult]
}

enum BookSearchError: Error, LocalizedError {
    case badResponse(Int)
    case decoding(Error)
    case transport(Error)

    var errorDescription: String? {
        switch self {
        case .badResponse(let code): return "Server returned status \(code)"
        case .decoding(let err): return "Couldn't read the server response: \(err.localizedDescription)"
        case .transport(let err): return err.localizedDescription
        }
    }
}
