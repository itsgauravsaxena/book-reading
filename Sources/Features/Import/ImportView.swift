import CoreData
import SwiftUI
import UniformTypeIdentifiers

struct ImportView: View {
    @Environment(\.managedObjectContext) private var ctx
    @Environment(\.dismiss) private var dismiss

    @State private var showFileImporter = false
    @State private var summary: ImportSummary?
    @State private var errorMessage: String?
    @State private var isWorking = false

    private var templateURL: URL? {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("bibliophil-template.csv")
        try? ReadingImporter.templateCSV().write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Bring your reading history from another app. Export it as a **CSV** file, then import it here. Sessions with a date and duration rebuild your streak and stats.")
                        .font(.subheadline)
                }

                Section("Expected columns") {
                    columnHelp("Title", "required (or ISBN)")
                    columnHelp("Author", "optional")
                    columnHelp("ISBN", "optional, used to match books")
                    columnHelp("Date", "a reading day, e.g. 2026-01-05")
                    columnHelp("Minutes", "duration: 45, 1:30, or 1h 30m")
                    columnHelp("Pages / CurrentPage / PagesRead / Finished", "optional")
                    Text("Column names are matched loosely, so Goodreads/StoryGraph-style exports work too.")
                        .font(.caption).foregroundColor(.secondary)
                }

                Section {
                    if let url = templateURL {
                        ShareLink(item: url) {
                            Label("Get a CSV template", systemImage: "square.and.arrow.up")
                        }
                    }
                    Button {
                        showFileImporter = true
                    } label: {
                        Label("Choose CSV file…", systemImage: "tray.and.arrow.down")
                    }
                    .disabled(isWorking)
                }

                if let summary {
                    Section("Imported") {
                        resultRow("Books added", summary.booksCreated)
                        resultRow("Books matched", summary.booksMatched)
                        resultRow("Sessions added", summary.sessionsCreated)
                        if summary.sessionsSkipped > 0 {
                            resultRow("Duplicate sessions skipped", summary.sessionsSkipped)
                        }
                        if summary.rowsSkipped > 0 {
                            resultRow("Rows skipped (no title)", summary.rowsSkipped)
                        }
                        if !summary.warnings.isEmpty {
                            ForEach(summary.warnings.prefix(5), id: \.self) { w in
                                Text(w).font(.caption).foregroundColor(.orange)
                            }
                        }
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage).foregroundColor(.red).font(.subheadline)
                    }
                }
            }
            .navigationTitle("Import History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(summary == nil ? "Cancel" : "Done") { dismiss() }
                }
            }
            .fileImporter(
                isPresented: $showFileImporter,
                allowedContentTypes: [.commaSeparatedText, .plainText, .text],
                allowsMultipleSelection: false
            ) { result in
                handlePicked(result)
            }
        }
    }

    private func columnHelp(_ name: String, _ note: String) -> some View {
        HStack {
            Text(name).font(.subheadline.weight(.medium))
            Spacer()
            Text(note).font(.caption).foregroundColor(.secondary)
        }
    }

    private func resultRow(_ label: String, _ value: Int) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text("\(value)").monospacedDigit().fontWeight(.semibold)
        }
    }

    private func handlePicked(_ result: Result<[URL], Error>) {
        errorMessage = nil
        summary = nil
        do {
            guard let url = try result.get().first else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }

            let data = try Data(contentsOf: url)
            let text = String(data: data, encoding: .utf8)
                ?? String(data: data, encoding: .isoLatin1)
                ?? ""
            isWorking = true
            let result = try ReadingImporter.importCSV(text, into: ctx)
            isWorking = false
            summary = result
            if result.isEmpty && result.rowsSkipped == 0 {
                errorMessage = "No importable rows were found. Check the header row matches the expected columns."
            }
        } catch {
            isWorking = false
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}

struct ImportView_Previews: PreviewProvider {
    static var previews: some View {
        ImportView()
            .environment(\.managedObjectContext, PersistenceController.preview.container.viewContext)
    }
}
