import CoreData
import SwiftUI

struct LibraryView: View {
    @Environment(\.managedObjectContext) private var ctx
    @State private var showingAdd = false
    @State private var showingImport = false
    @State private var filter: Filter = .reading

    enum Filter: String, CaseIterable, Identifiable {
        case reading = "Reading"
        case finished = "Finished"
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Filter", selection: $filter) {
                    ForEach(Filter.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.bottom, 8)

                Group {
                    if filter == .reading {
                        BookList(predicate: NSPredicate(format: "finishedAt == nil"))
                    } else {
                        BookList(predicate: NSPredicate(format: "finishedAt != nil"))
                    }
                }
            }
            .navigationTitle("Library")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button { showingAdd = true } label: {
                            Label("Add book", systemImage: "magnifyingglass")
                        }
                        Button { showingImport = true } label: {
                            Label("Import history (CSV)", systemImage: "tray.and.arrow.down")
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Add book")
                }
            }
            .sheet(isPresented: $showingAdd) {
                AddBookView()
                    .environment(\.managedObjectContext, ctx)
            }
            .sheet(isPresented: $showingImport) {
                ImportView()
                    .environment(\.managedObjectContext, ctx)
            }
        }
    }
}

private struct BookList: View {
    @Environment(\.managedObjectContext) private var ctx
    @FetchRequest private var books: FetchedResults<BookEntity>

    init(predicate: NSPredicate) {
        _books = FetchRequest(
            sortDescriptors: [NSSortDescriptor(keyPath: \BookEntity.addedAt, ascending: false)],
            predicate: predicate,
            animation: .default
        )
    }

    var body: some View {
        if books.isEmpty {
            EmptyLibraryState()
        } else {
            List {
                ForEach(books) { book in
                    NavigationLink {
                        BookDetailView(book: book)
                    } label: {
                        BookRow(book: book)
                    }
                }
                .onDelete(perform: delete)
            }
            .listStyle(.plain)
        }
    }

    private func delete(at offsets: IndexSet) {
        for idx in offsets { ctx.delete(books[idx]) }
        try? ctx.save()
    }
}

private struct BookRow: View {
    @ObservedObject var book: BookEntity

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            BookCover(url: book.coverURL.flatMap(URL.init(string:)), title: book.title ?? "")
            VStack(alignment: .leading, spacing: 4) {
                Text(book.title ?? "Untitled")
                    .font(.headline)
                    .lineLimit(2)
                Text(book.displayAuthors)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                if book.pageCount > 0 {
                    HStack(spacing: 6) {
                        ThinProgressBar(fraction: book.progressFraction)
                        Text("\(book.currentPage)/\(book.pageCount)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .monospacedDigit()
                    }
                    .padding(.top, 4)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }
}

private struct EmptyLibraryState: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "books.vertical")
                .font(.system(size: 56))
                .foregroundColor(.accentColor.opacity(0.7))
            Text("Your shelf is empty")
                .font(.title3.weight(.semibold))
            Text("Tap + to add the books you're reading.")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct LibraryView_Previews: PreviewProvider {
    static var previews: some View {
        LibraryView()
            .environment(\.managedObjectContext, PersistenceController.preview.container.viewContext)
    }
}
