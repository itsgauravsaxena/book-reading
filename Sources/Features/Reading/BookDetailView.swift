import CoreData
import SwiftUI

struct BookDetailView: View {
    @Environment(\.managedObjectContext) private var ctx
    @ObservedObject var book: BookEntity
    @State private var showTimer = false
    @State private var showManualSession = false
    @State private var showEditPage = false
    @State private var newPageText = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                header
                progressCard
                sessionsList
            }
            .padding()
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button {
                        toggleFinished()
                    } label: {
                        Label(book.isFinished ? "Mark as reading" : "Mark as finished",
                              systemImage: book.isFinished ? "book" : "checkmark.seal")
                    }
                    Button {
                        newPageText = String(book.currentPage)
                        showEditPage = true
                    } label: {
                        Label("Update current page", systemImage: "pencil")
                    }
                    Button {
                        showManualSession = true
                    } label: {
                        Label("Log past session", systemImage: "calendar.badge.plus")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showTimer) {
            ReadingTimerView(book: book)
                .environment(\.managedObjectContext, ctx)
        }
        .sheet(isPresented: $showManualSession) {
            ManualSessionView(book: book)
                .environment(\.managedObjectContext, ctx)
        }
        .alert("Current page", isPresented: $showEditPage) {
            TextField("Page", text: $newPageText)
                .keyboardType(.numberPad)
            Button("Save") {
                if let n = Int32(newPageText) { book.currentPage = max(0, n); try? ctx.save() }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 16) {
            BookCover(url: book.coverURL.flatMap(URL.init(string:)),
                      title: book.title ?? "", width: 96)
            VStack(alignment: .leading, spacing: 6) {
                Text(book.title ?? "Untitled").font(.title3.weight(.semibold))
                Text(book.displayAuthors).font(.subheadline).foregroundColor(.secondary)
                if let isbn = book.isbn, !isbn.isEmpty {
                    Text("ISBN \(isbn)").font(.caption).foregroundColor(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private var progressCard: some View {
        VStack(spacing: 12) {
            HStack {
                VStack(alignment: .leading) {
                    Text("Progress").font(.caption).foregroundColor(.secondary)
                    Text("\(book.currentPage) / \(book.pageCount > 0 ? "\(book.pageCount)" : "—")")
                        .font(.title3.weight(.semibold)).monospacedDigit()
                }
                Spacer()
                VStack(alignment: .trailing) {
                    Text("Total time").font(.caption).foregroundColor(.secondary)
                    Text(Format.clock(from: totalSeconds))
                        .font(.title3.weight(.semibold)).monospacedDigit()
                }
            }
            ThinProgressBar(fraction: book.progressFraction)
            Button {
                showTimer = true
            } label: {
                Label("Start reading", systemImage: "play.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.top, 4)

            Button {
                showManualSession = true
            } label: {
                Label("Log past session", systemImage: "calendar.badge.plus")
                    .font(.subheadline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
        }
        .padding()
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
    }

    private var sessionsList: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("History").font(.headline)
            let sessions = (book.sessions as? Set<ReadingSessionEntity>)?
                .sorted(by: { ($0.startedAt ?? .distantPast) > ($1.startedAt ?? .distantPast) }) ?? []
            if sessions.isEmpty {
                Text("No sessions yet.")
                    .font(.subheadline).foregroundColor(.secondary)
                    .padding(.vertical, 8)
            } else {
                ForEach(sessions.prefix(20), id: \.objectID) { s in
                    HStack {
                        Text(s.startedAt ?? Date(), format: .dateTime.day().month(.abbreviated).hour().minute())
                            .font(.subheadline)
                        Spacer()
                        Text(Format.clock(from: Int(s.durationSeconds))).monospacedDigit()
                            .font(.subheadline).foregroundColor(.secondary)
                    }
                    .padding(.vertical, 6)
                    Divider()
                }
            }
        }
    }

    private var totalSeconds: Int {
        let set = (book.sessions as? Set<ReadingSessionEntity>) ?? []
        return set.reduce(0) { $0 + Int($1.durationSeconds) }
    }

    private func toggleFinished() {
        book.finishedAt = book.isFinished ? nil : Date()
        try? ctx.save()
    }
}
