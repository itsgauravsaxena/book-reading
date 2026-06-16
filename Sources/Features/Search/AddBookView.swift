import CoreData
import SwiftUI

struct AddBookView: View {
    @Environment(\.managedObjectContext) private var ctx
    @Environment(\.dismiss) private var dismiss

    @State private var queryText: String = ""
    @State private var scope: Scope = .title
    @State private var results: [BookSearchResult] = []
    @State private var searchTask: Task<Void, Never>?
    @State private var isSearching = false
    @State private var errorMessage: String?

    private let service: BookSearchService = CompositeBookSearch()

    enum Scope: String, CaseIterable, Identifiable {
        case title = "Title"
        case author = "Author"
        case isbn = "ISBN"
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Search by", selection: $scope) {
                    ForEach(Scope.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.top, 8)

                content
            }
            .navigationTitle("Add Book")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $queryText, prompt: prompt)
            .onChange(of: queryText) { _ in scheduleSearch() }
            .onChange(of: scope) { _ in scheduleSearch() }
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    NavigationLink {
                        ManualEntryView { saveManual($0) }
                    } label: {
                        Text("Manual")
                    }
                }
            }
        }
    }

    @ViewBuilder private var content: some View {
        if let errorMessage {
            VStack(spacing: 8) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.largeTitle)
                    .foregroundColor(.orange)
                Text(errorMessage).font(.subheadline).foregroundColor(.secondary)
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if results.isEmpty && !queryText.isEmpty && !isSearching {
            ContentUnavailable(text: "No matches", systemImage: "magnifyingglass")
        } else if results.isEmpty {
            ContentUnavailable(text: "Search for a book", systemImage: "magnifyingglass")
        } else {
            List(results) { result in
                Button { save(result) } label: {
                    ResultRow(result: result)
                }
                .buttonStyle(.plain)
            }
            .listStyle(.plain)
            .overlay(alignment: .top) {
                if isSearching {
                    ProgressView()
                        .padding(8)
                        .background(.regularMaterial, in: Capsule())
                        .padding(.top, 4)
                }
            }
        }
    }

    private var prompt: String {
        switch scope {
        case .title:  return "Search by title"
        case .author: return "Search by author"
        case .isbn:   return "Enter ISBN-10 or ISBN-13"
        }
    }

    private func scheduleSearch() {
        searchTask?.cancel()
        let trimmed = queryText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            results = []
            isSearching = false
            errorMessage = nil
            return
        }
        let query: BookSearchQuery
        switch scope {
        case .title:  query = .title(trimmed)
        case .author: query = .author(trimmed)
        case .isbn:   query = .isbn(trimmed)
        }
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            if Task.isCancelled { return }
            await runSearch(query)
        }
    }

    @MainActor
    private func runSearch(_ query: BookSearchQuery) async {
        isSearching = true
        errorMessage = nil
        defer { isSearching = false }
        do {
            let r = try await service.search(query)
            if !Task.isCancelled { results = r }
        } catch {
            if !Task.isCancelled { errorMessage = error.localizedDescription }
        }
    }

    private func save(_ result: BookSearchResult) {
        let book = BookEntity(context: ctx)
        book.id = UUID()
        book.title = result.title
        book.authorsRaw = result.authors.joined(separator: ", ")
        book.isbn = result.isbn
        book.coverURL = result.coverURL?.absoluteString
        book.pageCount = Int32(result.pageCount ?? 0)
        book.source = result.source.rawValue
        book.externalId = result.externalId
        book.addedAt = Date()
        try? ctx.save()
        dismiss()
    }

    private func saveManual(_ draft: ManualBookDraft) {
        let book = BookEntity(context: ctx)
        book.id = UUID()
        book.title = draft.title
        book.authorsRaw = draft.authors
        book.pageCount = Int32(draft.pageCount ?? 0)
        book.source = BookSource.manual.rawValue
        book.addedAt = Date()
        try? ctx.save()
        dismiss()
    }
}

private struct ResultRow: View {
    let result: BookSearchResult

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            BookCover(url: result.coverURL, title: result.title, width: 56)
            VStack(alignment: .leading, spacing: 4) {
                Text(result.title).font(.headline).lineLimit(2)
                Text(result.authors.isEmpty ? "Unknown author" : result.authors.joined(separator: ", "))
                    .font(.subheadline).foregroundColor(.secondary).lineLimit(1)
                HStack(spacing: 6) {
                    if let year = result.publishedYear {
                        Label("\(String(year))", systemImage: "calendar")
                    }
                    if let pages = result.pageCount, pages > 0 {
                        Label("\(pages) pp", systemImage: "doc.text")
                    }
                    SourceBadge(source: result.source)
                }
                .font(.caption)
                .foregroundColor(.secondary)
                .labelStyle(.titleOnly)
            }
            Spacer(minLength: 0)
            Image(systemName: "plus.circle.fill")
                .foregroundColor(.accentColor)
                .font(.title3)
        }
        .padding(.vertical, 4)
    }
}

private struct SourceBadge: View {
    let source: BookSource
    var body: some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundColor(color)
    }
    private var label: String {
        switch source {
        case .googleBooks: return "Google"
        case .openLibrary: return "OpenLib"
        case .manual: return "Manual"
        }
    }
    private var color: Color {
        switch source {
        case .googleBooks: return .blue
        case .openLibrary: return .green
        case .manual: return .gray
        }
    }
}

private struct ContentUnavailable: View {
    let text: String
    let systemImage: String
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: systemImage).font(.system(size: 44)).foregroundColor(.secondary)
            Text(text).font(.subheadline).foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ManualBookDraft {
    var title: String
    var authors: String
    var pageCount: Int?
}

private struct ManualEntryView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var authors = ""
    @State private var pageCountText = ""
    let onSave: (ManualBookDraft) -> Void

    var body: some View {
        Form {
            Section("Book") {
                TextField("Title", text: $title)
                TextField("Authors (comma-separated)", text: $authors)
                TextField("Page count (optional)", text: $pageCountText)
                    .keyboardType(.numberPad)
            }
        }
        .navigationTitle("Manual Entry")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Save") {
                    let draft = ManualBookDraft(
                        title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                        authors: authors.trimmingCharacters(in: .whitespacesAndNewlines),
                        pageCount: Int(pageCountText)
                    )
                    onSave(draft)
                    dismiss()
                }
                .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }
}
