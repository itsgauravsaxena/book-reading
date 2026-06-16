import CoreData
import SwiftUI

struct ManualSessionView: View {
    @Environment(\.managedObjectContext) private var ctx
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var book: BookEntity

    @State private var date = Date()
    @State private var hours = 0
    @State private var minutes = 30
    @State private var pagesReadText = ""
    @State private var currentPageText = ""
    @State private var markFinished = false

    private var totalSeconds: Int { hours * 3600 + minutes * 60 }
    private var isValid: Bool { totalSeconds > 0 }

    var body: some View {
        NavigationStack {
            Form {
                Section("When did you read?") {
                    DatePicker(
                        "Date & time",
                        selection: $date,
                        in: ...Date(),
                        displayedComponents: [.date, .hourAndMinute]
                    )
                }

                Section("How long?") {
                    HStack(spacing: 0) {
                        durationWheel(value: $hours, range: 0...23, unit: "h")
                        durationWheel(value: $minutes, range: 0...59, unit: "m")
                    }
                    .frame(height: 120)
                    if !isValid {
                        Text("Duration must be more than zero.")
                            .font(.caption).foregroundColor(.red)
                    }
                }

                Section("Progress (optional)") {
                    TextField("Pages read this session", text: $pagesReadText)
                        .keyboardType(.numberPad)
                    TextField("Current page after reading", text: $currentPageText)
                        .keyboardType(.numberPad)
                }

                if !book.isFinished {
                    Section {
                        Toggle("Mark book finished on this date", isOn: $markFinished)
                    }
                }
            }
            .navigationTitle("Log Past Session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save", action: save)
                        .fontWeight(.semibold)
                        .disabled(!isValid)
                }
            }
        }
    }

    private func durationWheel(value: Binding<Int>, range: ClosedRange<Int>, unit: String) -> some View {
        HStack(spacing: 2) {
            Picker("", selection: value) {
                ForEach(range, id: \.self) { Text("\($0)").tag($0) }
            }
            .pickerStyle(.wheel)
            .frame(maxWidth: .infinity)
            .clipped()
            Text(unit).font(.headline).foregroundColor(.secondary)
        }
    }

    private func save() {
        let session = ReadingSessionEntity(context: ctx)
        session.id = UUID()
        session.book = book
        session.startedAt = date
        session.endedAt = date.addingTimeInterval(TimeInterval(totalSeconds))
        session.durationSeconds = Int32(totalSeconds)
        session.pagesRead = Int32(pagesReadText) ?? 0
        session.dayKey = DayKey.make(from: date)

        if let page = Int32(currentPageText), page >= 0 {
            book.currentPage = page
        }
        if markFinished {
            book.finishedAt = date
        }
        try? ctx.save()
        WidgetSync.refresh(context: ctx)
        dismiss()
    }
}
