import Foundation

struct OpenLibraryService: BookSearchService {
    private let session: URLSession
    private let baseURL = URL(string: "https://openlibrary.org/search.json")!

    init(session: URLSession = .shared) {
        self.session = session
    }

    func search(_ query: BookSearchQuery) async throws -> [BookSearchResult] {
        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = [URLQueryItem(name: "limit", value: "20")]
        switch query {
        case .isbn(let v):
            items.append(URLQueryItem(name: "isbn", value: v.filter { $0.isNumber || $0 == "X" }))
        case .title(let v):
            items.append(URLQueryItem(name: "title", value: v))
        case .author(let v):
            items.append(URLQueryItem(name: "author", value: v))
        case .freeform(let v):
            items.append(URLQueryItem(name: "q", value: v))
        }
        comps.queryItems = items
        var req = URLRequest(url: comps.url!)
        req.timeoutInterval = 10

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw BookSearchError.transport(error)
        }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw BookSearchError.badResponse(code)
        }
        do {
            let decoded = try JSONDecoder().decode(OLResponse.self, from: data)
            return decoded.docs.compactMap { $0.toResult() }
        } catch {
            throw BookSearchError.decoding(error)
        }
    }
}

private struct OLResponse: Decodable {
    let docs: [Doc]

    struct Doc: Decodable {
        let key: String
        let title: String?
        let author_name: [String]?
        let isbn: [String]?
        let cover_i: Int?
        let number_of_pages_median: Int?
        let first_publish_year: Int?
    }
}

private extension OLResponse.Doc {
    func toResult() -> BookSearchResult? {
        guard let title, !title.isEmpty else { return nil }
        let coverURL: URL? = cover_i.flatMap { URL(string: "https://covers.openlibrary.org/b/id/\($0)-M.jpg") }
        return BookSearchResult(
            title: title,
            authors: author_name ?? [],
            isbn: isbn?.first,
            coverURL: coverURL,
            pageCount: number_of_pages_median,
            publishedYear: first_publish_year,
            source: .openLibrary,
            externalId: key
        )
    }
}
