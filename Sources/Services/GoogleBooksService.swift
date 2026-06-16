import Foundation

struct GoogleBooksService: BookSearchService {
    private let session: URLSession
    private let baseURL = URL(string: "https://www.googleapis.com/books/v1/volumes")!

    init(session: URLSession = .shared) {
        self.session = session
    }

    func search(_ query: BookSearchQuery) async throws -> [BookSearchResult] {
        let q: String
        switch query {
        case .isbn(let v):     q = "isbn:\(v.filter { $0.isNumber || $0 == "X" })"
        case .title(let v):    q = "intitle:\(v)"
        case .author(let v):   q = "inauthor:\(v)"
        case .freeform(let v): q = v
        }
        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "q", value: q),
            URLQueryItem(name: "maxResults", value: "20"),
            URLQueryItem(name: "printType", value: "books")
        ]
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
            let decoded = try JSONDecoder().decode(GBResponse.self, from: data)
            return (decoded.items ?? []).compactMap { $0.toResult() }
        } catch {
            throw BookSearchError.decoding(error)
        }
    }
}

private struct GBResponse: Decodable {
    let items: [Item]?

    struct Item: Decodable {
        let id: String
        let volumeInfo: VolumeInfo
    }

    struct VolumeInfo: Decodable {
        let title: String?
        let authors: [String]?
        let publishedDate: String?
        let pageCount: Int?
        let industryIdentifiers: [IndustryIdentifier]?
        let imageLinks: ImageLinks?
    }

    struct IndustryIdentifier: Decodable {
        let type: String
        let identifier: String
    }

    struct ImageLinks: Decodable {
        let thumbnail: String?
        let smallThumbnail: String?
    }
}

private extension GBResponse.Item {
    func toResult() -> BookSearchResult? {
        guard let title = volumeInfo.title, !title.isEmpty else { return nil }
        let isbn = volumeInfo.industryIdentifiers?
            .first(where: { $0.type == "ISBN_13" })?.identifier
            ?? volumeInfo.industryIdentifiers?
                .first(where: { $0.type == "ISBN_10" })?.identifier
        let coverString = volumeInfo.imageLinks?.thumbnail
            ?? volumeInfo.imageLinks?.smallThumbnail
        let coverURL = coverString.flatMap { URL(string: $0.replacingOccurrences(of: "http://", with: "https://")) }
        let year = volumeInfo.publishedDate.flatMap { Int($0.prefix(4)) }
        return BookSearchResult(
            title: title,
            authors: volumeInfo.authors ?? [],
            isbn: isbn,
            coverURL: coverURL,
            pageCount: volumeInfo.pageCount,
            publishedYear: year,
            source: .googleBooks,
            externalId: id
        )
    }
}
