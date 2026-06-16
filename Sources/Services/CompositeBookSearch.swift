import Foundation

struct CompositeBookSearch: BookSearchService {
    let primary: BookSearchService
    let fallback: BookSearchService

    init(primary: BookSearchService = GoogleBooksService(),
         fallback: BookSearchService = OpenLibraryService()) {
        self.primary = primary
        self.fallback = fallback
    }

    func search(_ query: BookSearchQuery) async throws -> [BookSearchResult] {
        do {
            let results = try await primary.search(query)
            if !results.isEmpty { return results }
        } catch {
            // Primary failed: fall through to fallback.
        }
        return try await fallback.search(query)
    }
}
